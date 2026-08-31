import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "event-waitlist-test-secret-at-least-32-characters";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import {
  createWaitlistManagementToken,
  getWaitlistManagement,
  listEventWaitlist,
  previewWaitlistImpact,
  reconcileEventWaitlist,
  requestEventWaitlist,
  updateWaitlistManagement,
} from "@/features/event-waitlist/waitlist.server";
import { normaliseEventInput, updateEvent } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { markTicketStatus } from "@/features/tickets/store.server";
import { memoryWindows } from "@/lib/platform/rate-limit.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const ORIGIN = "https://example.com";
const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

async function seedEvent(
  input: {
    capacity?: number;
    entryQuantity?: number;
    vipQuantity?: number;
    status?: "published" | "sold-out";
  } = {},
) {
  const event = normaliseEventInput({
    slug: "waitlist-night",
    title: "Waitlist Night",
    status: input.status ?? "published",
    area: "East London",
    startsAt: FUTURE(),
    capacity: input.capacity,
    waitlistEnabled: true,
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity: input.entryQuantity ?? 1,
        perPersonLimit: 4,
      },
      ...(input.vipQuantity === undefined
        ? []
        : [
            {
              id: "vip",
              name: "VIP",
              priceMinor: 0,
              currency: "GBP",
              quantity: input.vipQuantity,
              perPersonLimit: 4,
            },
          ]),
    ],
  });
  if (!event.ok) throw new Error(event.error);
  await putEvent(event.value);
  return event.value;
}

async function sell(ticketTypeId = "entry") {
  const issued = await issueTickets({
    eventSlug: "waitlist-night",
    ticketTypeId,
    holderName: "Ticket holder",
    email: `${ticketTypeId}@example.com`,
    quantity: 1,
    kind: "free",
  });
  if (!issued.ok) throw new Error(issued.error);
  return issued.value.tickets[0]!;
}

async function joinAndConfirm(email: string, ticketTypeId: string | null = "entry") {
  const requested = await requestEventWaitlist({
    eventSlug: "waitlist-night",
    email,
    scope: ticketTypeId ? { kind: "ticket-type", ticketTypeId } : { kind: "event" },
    origin: ORIGIN,
    ip: `test-${email}`,
    deliverNow: false,
  });
  if (!requested.ok) throw new Error(requested.error);
  const rows = await query<{ id: string; confirmation_version: number }>(
    `select id,confirmation_version from event_waitlist_entries where event_slug = $1 and email = $2
      order by created_at desc limit 1`,
    ["waitlist-night", email],
  );
  const entry = rows[0];
  const id = entry?.id;
  const token = entry ? createWaitlistManagementToken(entry.id, entry.confirmation_version) : null;
  if (!id || !token) throw new Error("Waitlist token missing");
  const confirmed = await updateWaitlistManagement({
    token,
    action: "confirm",
    origin: ORIGIN,
    deliverNow: false,
  });
  if (!confirmed.ok) throw new Error(confirmed.error);
  return { id, token };
}

describeWithDatabase("event waitlists (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    memoryWindows.clear();
  });

  it("requires email confirmation, previews an inventory edit, and queues one idempotent alert", async () => {
    const event = await seedEvent();
    await sell();

    const requested = await requestEventWaitlist({
      eventSlug: event.slug,
      email: "Waiting@Example.com",
      scope: { kind: "ticket-type", ticketTypeId: "entry" },
      origin: ORIGIN,
      ip: "requester-1",
      deliverNow: false,
    });
    expect(requested.ok).toBe(true);
    const pending = await query<{
      id: string;
      email: string;
      status: string;
      confirmation_version: number;
    }>(`select id,email,status,confirmation_version from event_waitlist_entries`);
    expect(pending).toMatchObject([
      {
        email: "waiting@example.com",
        status: "pending",
        confirmation_version: 1,
      },
    ]);
    expect(
      await query<{ kind: string }>(`select kind from email_outbox order by created_at`),
    ).toEqual([{ kind: "waitlist-confirmation" }]);

    const token = createWaitlistManagementToken(pending[0]!.id, pending[0]!.confirmation_version);
    if (!token) throw new Error("Token was not signed");
    const confirmation = await updateWaitlistManagement({
      token,
      action: "confirm",
      origin: ORIGIN,
      deliverNow: false,
    });
    expect(confirmation).toMatchObject({ ok: true, value: { status: "active" } });

    const nextTypes = [{ ...event.ticketTypes[0]!, quantity: 2 }];
    const preview = await previewWaitlistImpact(event.slug, { ticketTypes: nextTypes });
    expect(preview).toEqual({
      ok: true,
      value: {
        count: 1,
        scopes: [{ ticketTypeId: "entry", label: "Entry", count: 1 }],
      },
    });
    const updated = await updateEvent(event.slug, { ticketTypes: nextTypes });
    if (!updated.ok) throw new Error(updated.error);

    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toMatchObject({ count: 1 });
    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toEqual({ count: 0, scopes: [] });

    const outbox = await query<{ kind: string; count: string }>(
      `select kind,count(*)::text as count from email_outbox group by kind order by kind`,
    );
    expect(outbox).toEqual([
      { kind: "waitlist-availability", count: "1" },
      { kind: "waitlist-confirmation", count: "1" },
    ]);
    const management = await getWaitlistManagement(token);
    expect(management).toMatchObject({ ok: true, value: { status: "notified" } });
    const admin = await listEventWaitlist(event.slug);
    expect(admin.counts.notified).toBe(1);
    expect(admin.entries[0]).toMatchObject({
      email: "waiting@example.com",
      scopeLabel: "Entry",
      status: "notified",
    });
  });

  it("invalidates an earlier confirmation link when a pending request is refreshed", async () => {
    const event = await seedEvent();
    await sell();
    const request = (ip: string) =>
      requestEventWaitlist({
        eventSlug: event.slug,
        email: "refresh@example.com",
        scope: { kind: "ticket-type" as const, ticketTypeId: "entry" },
        origin: ORIGIN,
        ip,
        deliverNow: false,
      });

    await expect(request("refresh-1")).resolves.toMatchObject({ ok: true });
    const first = await query<{ id: string; confirmation_version: number }>(
      `select id,confirmation_version from event_waitlist_entries where email = $1`,
      ["refresh@example.com"],
    );
    const oldToken = createWaitlistManagementToken(first[0]!.id, first[0]!.confirmation_version);
    if (!oldToken) throw new Error("Initial waitlist token missing");

    await expect(request("refresh-2")).resolves.toMatchObject({ ok: true });
    await expect(getWaitlistManagement(oldToken)).resolves.toMatchObject({
      ok: false,
      status: 404,
    });

    const refreshed = await query<{ id: string; confirmation_version: number }>(
      `select id,confirmation_version from event_waitlist_entries where email = $1`,
      ["refresh@example.com"],
    );
    expect(refreshed[0]).toMatchObject({
      id: first[0]!.id,
      confirmation_version: first[0]!.confirmation_version + 1,
    });
    const currentToken = createWaitlistManagementToken(
      refreshed[0]!.id,
      refreshed[0]!.confirmation_version,
    );
    if (!currentToken) throw new Error("Refreshed waitlist token missing");
    await expect(
      updateWaitlistManagement({
        token: currentToken,
        action: "confirm",
        origin: ORIGIN,
        deliverNow: false,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: "active" } });
  });

  it("keeps one notification credit for pending confirmations without over-alerting", async () => {
    const event = await seedEvent();
    await sell();
    for (const [index, email] of ["pending-one@example.com", "pending-two@example.com"].entries()) {
      await expect(
        requestEventWaitlist({
          eventSlug: event.slug,
          email,
          scope: { kind: "ticket-type", ticketTypeId: "entry" },
          origin: ORIGIN,
          ip: `pending-${index}`,
          deliverNow: false,
        }),
      ).resolves.toMatchObject({ ok: true });
    }

    const nextTypes = [{ ...event.ticketTypes[0]!, quantity: 2 }];
    const updated = await updateEvent(event.slug, { ticketTypes: nextTypes });
    if (!updated.ok) throw new Error(updated.error);
    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toEqual({ count: 0, scopes: [] });

    const pending = await query<{ id: string; confirmation_version: number; email: string }>(
      `select id,confirmation_version,email
         from event_waitlist_entries order by created_at,email`,
    );
    const tokens = pending.map((entry) => ({
      email: entry.email,
      token: createWaitlistManagementToken(entry.id, entry.confirmation_version),
    }));
    if (!tokens[0]?.token || !tokens[1]?.token) throw new Error("Pending tokens missing");

    await expect(
      updateWaitlistManagement({
        token: tokens[0].token,
        action: "confirm",
        origin: ORIGIN,
        deliverNow: false,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: "notified" } });
    await expect(
      updateWaitlistManagement({
        token: tokens[1].token,
        action: "confirm",
        origin: ORIGIN,
        deliverNow: false,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: "active" } });
    await expect(
      query<{ count: string }>(
        `select count(*)::text as count from email_outbox where kind = 'waitlist-availability'`,
      ),
    ).resolves.toEqual([{ count: "1" }]);
  });

  it("notifies FIFO by newly opened place and catches the next person after a refund", async () => {
    const event = await seedEvent();
    const soldTicket = await sell();
    const first = await joinAndConfirm("first@example.com");
    const second = await joinAndConfirm("second@example.com");
    const third = await joinAndConfirm("third@example.com");
    await query(
      `update event_waitlist_entries
          set confirmed_at = case id
            when $1 then now() - interval '3 minutes'
            when $2 then now() - interval '2 minutes'
            when $3 then now() - interval '1 minute' end
        where id = any($4::uuid[])`,
      [first.id, second.id, third.id, [first.id, second.id, third.id]],
    );

    const nextTypes = [{ ...event.ticketTypes[0]!, quantity: 2 }];
    const updated = await updateEvent(event.slug, { ticketTypes: nextTypes });
    if (!updated.ok) throw new Error(updated.error);
    expect(
      await reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).toMatchObject({ count: 1 });
    expect(
      await query<{ email: string; status: string }>(
        `select email,status from event_waitlist_entries order by confirmed_at`,
      ),
    ).toMatchObject([
      { email: "first@example.com", status: "notified" },
      { email: "second@example.com", status: "active" },
      { email: "third@example.com", status: "active" },
    ]);

    await markTicketStatus(soldTicket.id, "refunded", "refund_waitlist_test");
    expect(
      await reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).toMatchObject({ count: 1 });
    expect(
      await query<{ email: string; status: string }>(
        `select email,status from event_waitlist_entries order by confirmed_at`,
      ),
    ).toMatchObject([
      { email: "first@example.com", status: "notified" },
      { email: "second@example.com", status: "notified" },
      { email: "third@example.com", status: "active" },
    ]);
  });

  it("skips a suppressed address and gives the opened place to the next person", async () => {
    const event = await seedEvent();
    await sell();
    const blocked = await joinAndConfirm("blocked@example.com");
    await joinAndConfirm("deliverable@example.com");
    await query(
      `insert into email_suppressions
         (recipient_hash,reason,provider_message_id,first_occurred_at,last_occurred_at)
       select email_hash,'bounced','waitlist-test',now(),now()
         from event_waitlist_entries where id = $1`,
      [blocked.id],
    );

    const nextTypes = [{ ...event.ticketTypes[0]!, quantity: 2 }];
    const updated = await updateEvent(event.slug, { ticketTypes: nextTypes });
    if (!updated.ok) throw new Error(updated.error);
    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toMatchObject({ count: 1 });
    await expect(
      query<{ email: string; status: string }>(
        `select email,status from event_waitlist_entries order by confirmed_at`,
      ),
    ).resolves.toMatchObject([
      { email: "blocked@example.com", status: "undeliverable" },
      { email: "deliverable@example.com", status: "notified" },
    ]);
  });

  it("caps shared event capacity alerts across event-wide and ticket-specific scopes", async () => {
    const event = await seedEvent({ capacity: 2, entryQuantity: 2, vipQuantity: 2 });
    await sell("entry");
    await sell("vip");
    const specific = await joinAndConfirm("entry-waiter@example.com", "entry");
    const anyTicket = await joinAndConfirm("any-waiter@example.com", null);
    await query(
      `update event_waitlist_entries
          set confirmed_at = case when id = $1 then now() - interval '2 minutes'
                                  when id = $2 then now() - interval '1 minute' end
        where id = any($3::uuid[])`,
      [specific.id, anyTicket.id, [specific.id, anyTicket.id]],
    );

    const preview = await previewWaitlistImpact(event.slug, { capacity: 3 });
    expect(preview).toMatchObject({ ok: true, value: { count: 1 } });
    const updated = await updateEvent(event.slug, { capacity: 3 });
    if (!updated.ok) throw new Error(updated.error);
    const impact = await reconcileEventWaitlist({
      eventSlug: event.slug,
      origin: ORIGIN,
      deliverNow: false,
    });
    expect(impact.count).toBe(1);
    const statuses = await query<{ email: string; status: string }>(
      `select email,status from event_waitlist_entries order by confirmed_at`,
    );
    expect(statuses.filter((entry) => entry.status === "notified")).toHaveLength(1);
    expect(statuses.filter((entry) => entry.status === "active")).toHaveLength(1);
  });

  it("expires a ticket-specific entry without losing its label when that type is removed", async () => {
    const event = await seedEvent({ status: "sold-out", vipQuantity: 1 });
    await joinAndConfirm("removed-type@example.com", "entry");
    const updated = await updateEvent(event.slug, { ticketTypes: [event.ticketTypes[1]!] });
    if (!updated.ok) throw new Error(updated.error);

    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toEqual({ count: 0, scopes: [] });
    const admin = await listEventWaitlist(event.slug);
    expect(admin.entries[0]).toMatchObject({
      email: "removed-type@example.com",
      scopeLabel: "Entry",
      status: "expired",
    });
  });

  it("lets a confirmed person leave and rejects signup while matching tickets are available", async () => {
    const event = await seedEvent();
    await sell();
    const joined = await joinAndConfirm("leaving@example.com");
    const left = await updateWaitlistManagement({
      token: joined.token,
      action: "leave",
      origin: ORIGIN,
      deliverNow: false,
    });
    expect(left).toMatchObject({ ok: true, value: { status: "left" } });

    const nextTypes = [{ ...event.ticketTypes[0]!, quantity: 2 }];
    const updated = await updateEvent(event.slug, { ticketTypes: nextTypes });
    if (!updated.ok) throw new Error(updated.error);
    await expect(
      reconcileEventWaitlist({ eventSlug: event.slug, origin: ORIGIN, deliverNow: false }),
    ).resolves.toEqual({ count: 0, scopes: [] });
    await expect(
      requestEventWaitlist({
        eventSlug: event.slug,
        email: "too-late@example.com",
        scope: { kind: "ticket-type", ticketTypeId: "entry" },
        origin: ORIGIN,
        ip: "requester-available",
        deliverNow: false,
      }),
    ).resolves.toMatchObject({ ok: false, status: 409, error: "Tickets are available now" });
  });
});
