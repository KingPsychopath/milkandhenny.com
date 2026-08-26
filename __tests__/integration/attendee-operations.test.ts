import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";
process.env.APP_BASE_URL = "https://milkandhenny.com";

const email = vi.hoisted(() => ({ send: vi.fn() }));
const refund = vi.hoisted(() => ({ ticket: vi.fn() }));

vi.mock("@/lib/platform/email.server", () => ({ sendEmail: email.send }));
vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/features/event-scoring/session.server", () => ({
  authenticateAttendeeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/tickets/checkout.server", () => ({ refundTicket: refund.ticket }));

import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { getTicket } from "@/features/tickets/store.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import {
  acceptRefundConsent,
  acceptTicketAction,
  cancelPendingTicketOperation,
  cancelTransferredTicketReturn,
  declineRefundConsent,
  expireTicketOperations,
  inspectTicketAction,
  requestTicketAssignment,
  requestTicketTransfer,
  requestTransferredTicketReturn,
  resendPendingTicketOperation,
  ticketOperationsForPerson,
} from "@/features/attendee-operations/ticket-operations.server";
import {
  getEventOperationsPolicy,
  getGlobalOperationsSettings,
  isCapabilityEffective,
  updateEventOperationsPolicy,
  updateGlobalOperationsSettings,
} from "@/features/attendee-operations/capabilities.server";
import {
  emitDomainEvent,
  listAdminInbox,
  listAlertRecipients,
  revokeAlertRecipient,
  saveAlertRecipient,
  setAdminNotificationReadState,
  sendOperationsDigests,
  sendTestAlert,
  updateAdminNotification,
} from "@/features/attendee-operations/notifications.server";
import { actionEmailHash } from "@/features/attendee-operations/action-links.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const SLUG = "attendee-operations-night";
const BUYER = "0198e9d8-53d7-7db7-9834-8896a69f1bdb";
const BUYER_IDENTIFIER = "0198e9d8-53d7-7db8-a907-34db95bc731b";
const BUYER_EMAIL = "buyer@example.com";

async function seedEvent() {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Attendee Operations Night",
    status: "published",
    area: "London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [{ id: "entry", name: "Entry", priceMinor: 1000, currency: "GBP", quantity: 20 }],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
  await query(`insert into event_people (id,canonical_name) values ($1,'Buyer')`, [BUYER]);
  await query(
    `insert into event_person_identifiers
       (id,person_id,kind,value_hash,verified_at,display_hint)
     values ($1,$2,'email',$3,now(),'b•••@example.com')`,
    [BUYER_IDENTIFIER, BUYER, actionEmailHash(BUYER_EMAIL)],
  );
}

async function ticket(name: string, claimed = false) {
  const issued = await issueTickets({
    eventSlug: SLUG,
    ticketTypeId: "entry",
    holderName: name,
    email: BUYER_EMAIL,
    quantity: 1,
    kind: "paid",
    paymentRef: `pi_${name.toLowerCase().replaceAll(" ", "_")}`,
    amountPaidMinor: 1000,
    currency: "GBP",
  });
  if (!issued.ok) throw new Error(issued.error);
  const created = issued.value.tickets[0];
  await query(
    `insert into event_order_managers
       (id,event_slug,order_id,person_id,identifier_id,status,source)
     values ($1,$2,$3,$4,$5,'active','verified-purchaser-email')`,
    [`manager_${created.id}`, SLUG, created.orderId, BUYER, BUYER_IDENTIFIER],
  );
  if (claimed) {
    await query(`update event_participants set person_id = $2 where ticket_id = $1`, [
      created.id,
      BUYER,
    ]);
  }
  return created;
}

function latestActionToken(): string {
  for (const [message] of email.send.mock.calls.toReversed()) {
    const match = String(message.text).match(/\/action\/(mah_[A-Za-z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error("No action token was emailed");
}

describeWithDatabase("attendee operations workflows (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
    email.send.mockReset();
    email.send.mockResolvedValue({ ok: true, id: "email_queued" });
    refund.ticket.mockReset();
    refund.ticket.mockResolvedValue({
      ok: true,
      value: { state: "succeeded", refunded: 1, emailQueued: true },
    });
  });

  it("resends, replaces, accepts, cancels, and expires assignment links", async () => {
    const firstTicket = await ticket("Assignment one");
    const requested = await requestTicketAssignment({
      ticketId: firstTicket.id,
      purchaserPersonId: BUYER,
      recipientEmail: "guest@example.com",
      origin: "https://milkandhenny.com",
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const oldToken = latestActionToken();
    expect((await inspectTicketAction(oldToken))?.state).toBe("available");

    const resent = await resendPendingTicketOperation({
      kind: "assignment",
      operationId: requested.value.assignmentId,
      actorPersonId: BUYER,
      origin: "https://milkandhenny.com",
    });
    expect(resent.ok && resent.value.emailQueued).toBe(true);
    expect(await inspectTicketAction(oldToken)).toBeNull();
    const accepted = await acceptTicketAction(latestActionToken());
    expect(accepted.ok && accepted.value.purpose).toBe("ticket-assignment");

    const secondTicket = await ticket("Assignment two");
    const cancelledRequest = await requestTicketAssignment({
      ticketId: secondTicket.id,
      purchaserPersonId: BUYER,
      recipientEmail: "cancelled@example.com",
      origin: "https://milkandhenny.com",
    });
    if (!cancelledRequest.ok) throw new Error(cancelledRequest.error);
    expect(
      await cancelPendingTicketOperation({
        kind: "assignment",
        operationId: cancelledRequest.value.assignmentId,
        actorPersonId: BUYER,
      }),
    ).toEqual({ ok: true, value: { cancelled: true } });

    const expiringTicket = await ticket("Assignment expiry");
    const expiring = await requestTicketAssignment({
      ticketId: expiringTicket.id,
      purchaserPersonId: BUYER,
      recipientEmail: "expired@example.com",
      origin: "https://milkandhenny.com",
    });
    if (!expiring.ok) throw new Error(expiring.error);
    await query(
      `update ticket_assignments set expires_at = now() - interval '1 second' where id = $1`,
      [expiring.value.assignmentId],
    );
    expect(await expireTicketOperations()).toEqual({ assignments: 1, transfers: 0, returns: 0 });
    expect((await ticketOperationsForPerson(BUYER)).outgoingAssignments).toHaveLength(3);
  });

  it("rotates accepted transfers and completes two-party refund consent", async () => {
    const transferredTicket = await ticket("Transfer holder", true);
    await updateGlobalOperationsSettings({
      section: "globalAvailability",
      values: { transfers: true },
      actorId: "root-owner",
      actorType: "root-owner",
      reason: "Enable tested transfer workflow",
    });
    await updateEventOperationsPolicy({
      eventSlug: SLUG,
      capabilities: { transfers: true },
      actorId: "root-owner",
      actorType: "root-owner",
      reason: "Enable this event",
    });
    expect(await isCapabilityEffective(SLUG, "transfers")).toBe(true);

    const requested = await requestTicketTransfer({
      ticketId: transferredTicket.id,
      senderPersonId: BUYER,
      recipientEmail: "holder@example.com",
      origin: "https://milkandhenny.com",
    });
    if (!requested.ok) throw new Error(requested.error);
    const accepted = await acceptTicketAction(latestActionToken());
    expect(accepted.ok && accepted.value.publicTicketId).not.toBe(transferredTicket.id);
    const current = await getTicket(transferredTicket.id);
    expect(current?.accessReference).toBe(accepted.ok ? accepted.value.publicTicketId : undefined);

    const returnRequest = await requestTransferredTicketReturn({
      ticketId: transferredTicket.id,
      requesterPersonId: BUYER,
      origin: "https://milkandhenny.com",
    });
    expect(returnRequest.ok && returnRequest.value.emailQueued).toBe(true);
    const consent = await acceptRefundConsent(latestActionToken());
    expect(consent.ok && consent.value.state).toBe("succeeded");
    expect(refund.ticket).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: transferredTicket.id,
        returnRequestId: returnRequest.ok ? returnRequest.value.returnRequestId : undefined,
      }),
    );
    const completionRecipients = email.send.mock.calls
      .filter(([message]) => String(message.subject).includes("Ticket return confirmed"))
      .map(([message]) => message.to);
    expect(completionRecipients).toEqual(
      expect.arrayContaining([BUYER_EMAIL, "holder@example.com"]),
    );
  });

  it("lets the current holder initiate, decline, cancel, and expire return requests", async () => {
    const transferredTicket = await ticket("Holder return", true);
    await updateGlobalOperationsSettings({
      section: "globalAvailability",
      values: { transfers: true },
      actorId: "root-owner",
      actorType: "root-owner",
      reason: "Enable holder return workflow test",
    });
    await updateEventOperationsPolicy({
      eventSlug: SLUG,
      capabilities: { transfers: true },
      actorId: "root-owner",
      actorType: "root-owner",
      reason: "Enable this event",
    });
    const transfer = await requestTicketTransfer({
      ticketId: transferredTicket.id,
      senderPersonId: BUYER,
      recipientEmail: "returning-holder@example.com",
      origin: "https://milkandhenny.com",
    });
    if (!transfer.ok) throw new Error(transfer.error);
    const accepted = await acceptTicketAction(latestActionToken());
    if (!accepted.ok) throw new Error(accepted.error);

    const holderRequest = await requestTransferredTicketReturn({
      ticketId: transferredTicket.id,
      requesterPersonId: accepted.value.personId,
      origin: "https://milkandhenny.com",
    });
    if (!holderRequest.ok) throw new Error(holderRequest.error);
    expect(email.send.mock.calls.at(-1)?.[0].to).toBe(BUYER_EMAIL);
    expect(await declineRefundConsent(latestActionToken())).toEqual({
      ok: true,
      value: { declined: true },
    });

    const cancelledRequest = await requestTransferredTicketReturn({
      ticketId: transferredTicket.id,
      requesterPersonId: accepted.value.personId,
      origin: "https://milkandhenny.com",
    });
    if (!cancelledRequest.ok) throw new Error(cancelledRequest.error);
    expect(
      await cancelTransferredTicketReturn({
        returnRequestId: cancelledRequest.value.returnRequestId,
        actorPersonId: accepted.value.personId,
      }),
    ).toEqual({ ok: true, value: { cancelled: true } });

    const expiringRequest = await requestTransferredTicketReturn({
      ticketId: transferredTicket.id,
      requesterPersonId: BUYER,
      origin: "https://milkandhenny.com",
    });
    if (!expiringRequest.ok) throw new Error(expiringRequest.error);
    await query(
      `update ticket_return_requests set expires_at = now() - interval '1 second' where id = $1`,
      [expiringRequest.value.returnRequestId],
    );
    expect(await expireTicketOperations()).toEqual({ assignments: 0, transfers: 0, returns: 1 });
    expect((await ticketOperationsForPerson(accepted.value.personId)).returnRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expiringRequest.value.returnRequestId, status: "expired" }),
      ]),
    );
  });

  it("audits capabilities, alert recipients, and assigned operations cases", async () => {
    const global = await getGlobalOperationsSettings();
    expect(global.globalAvailability.transfers).toBe(false);
    const policy = await getEventOperationsPolicy(SLUG);
    expect(policy.capabilities.transfers).toBe(false);

    const saved = await saveAlertRecipient({
      email: BUYER_EMAIL,
      categories: ["refund-failed"],
      cadence: "digest",
      digestHour: new Date().getUTCHours(),
      quietHours: { start: 1, end: 2 },
      criticalOverride: true,
      fallback: true,
      actorId: "root-owner",
      actorType: "root-owner",
      reason: "Test the operations route",
    });
    expect(await listAlertRecipients()).toHaveLength(1);
    expect((await sendTestAlert({ recipientId: saved.id, actorId: "root-owner" })).queued).toBe(
      true,
    );
    await query(
      `insert into global_admin_grants
         (id,person_id,role_preset,status,issued_by_type,activated_at)
       values ('grant_buyer',$1,'owner','active','root-owner',now())`,
      [BUYER],
    );
    await emitDomainEvent({
      kind: "refund.failed",
      deduplicationKey: "refund-failed-test-case",
      actorType: "system",
      eventSlug: SLUG,
      entityRefs: { ticketId: "ticket_test" },
      severity: "critical",
      admin: {
        title: "Refund needs review",
        body: "Provider failure",
        deepLink: "/admin?view=operations",
        category: "refund-failed",
        createCase: true,
      },
    });
    const viewer = { actorId: BUYER, actorType: "admin" as const };
    const inbox = await listAdminInbox({
      viewer,
      severity: "critical",
      category: "refund-failed",
    });
    expect(inbox.items).toHaveLength(1);
    expect(inbox).toMatchObject({ unresolved: 1, unread: 1 });
    expect(inbox.items[0]).toMatchObject({ unread: true });
    expect(inbox.administrators).toEqual([{ personId: BUYER, name: "Buyer" }]);
    const item = inbox.items[0];
    expect(await setAdminNotificationReadState({ id: item.id, viewer, read: true })).toBe(true);
    expect((await listAdminInbox({ viewer })).unread).toBe(0);
    expect(
      (
        await listAdminInbox({
          viewer: { actorId: "another-admin", actorType: "admin" },
        })
      ).unread,
    ).toBe(1);
    expect(
      await updateAdminNotification({
        id: item.id,
        status: "in-progress",
        actorId: BUYER,
        actorType: "admin",
        assigneePersonId: BUYER,
        privateNote: "Checking the provider ledger",
      }),
    ).toBe(true);
    expect(
      await updateAdminNotification({
        id: item.id,
        status: "resolved",
        actorId: BUYER,
        actorType: "admin",
        reason: "Reconciled against provider records",
      }),
    ).toBe(true);
    expect((await listAdminInbox({ viewer, status: "resolved" })).items[0]).toMatchObject({
      assigneePersonId: BUYER,
      resolutionReason: "Reconciled against provider records",
      privateNote: { body: "Checking the provider ledger" },
    });
    expect((await sendOperationsDigests()).recipients).toBe(1);
    expect(
      await revokeAlertRecipient({
        id: saved.id,
        actorId: "root-owner",
        actorType: "root-owner",
        reason: "Test complete",
      }),
    ).toBe(true);
    expect(
      await queryOne<{ count: string }>(
        `select count(*)::text as count from attendee_operations_audit_events`,
      ),
    ).toEqual({ count: expect.not.stringMatching(/^0$/) });
  });

  it("rejects unsafe and incomplete operations without changing authority", async () => {
    expect(
      await requestTicketAssignment({
        ticketId: "missing",
        purchaserPersonId: BUYER,
        recipientEmail: "not-an-email",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await requestTicketTransfer({
        ticketId: "missing",
        senderPersonId: BUYER,
        recipientEmail: "not-an-email",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    await expect(
      updateGlobalOperationsSettings({
        section: "emergencyPaused",
        values: { transfers: true },
        actorId: "root-owner",
        actorType: "root-owner",
      }),
    ).rejects.toThrow("require a reason");
    await expect(
      updateEventOperationsPolicy({
        eventSlug: SLUG,
        transferOpensAt: "not-a-date",
        actorId: "root-owner",
        actorType: "root-owner",
        reason: "Exercise invalid window validation",
      }),
    ).rejects.toThrow("invalid");
    expect(
      await setAdminNotificationReadState({
        id: "notice_missing",
        viewer: { actorId: "root-owner", actorType: "root-owner" },
        read: true,
      }),
    ).toBe(false);
    expect(
      await revokeAlertRecipient({
        id: "recipient_missing",
        actorId: "root-owner",
        actorType: "root-owner",
        reason: "No longer required",
      }),
    ).toBe(false);
    expect(await expireTicketOperations()).toEqual({ assignments: 0, transfers: 0, returns: 0 });
  });
});
