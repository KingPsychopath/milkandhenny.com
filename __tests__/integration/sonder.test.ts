import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";
import { sonderOrder, HANGOUT, EVENT_ID, ORDER_ID } from "../helpers/sonder";
import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent, getEvent } from "@/features/events/store.server";
import { query } from "@/lib/platform/postgres.server";
import {
  configureSonderEvent,
  readSonderEvent,
  syncSonderEvent,
  allocateSonderBookings,
  prepareSonderTeams,
  previewSonderTeamEmails,
  queueSonderTeamEmails,
  receiveSonderEvent,
  assignSonderBooking,
  syncDueSonderEvents,
  acknowledgeSonderOrder,
} from "@/features/sonder/sonder.server";
import { parseSonderEvent } from "@/features/sonder/types";
import { handleSonderWebhook } from "@/src/routes/api/sonder/webhook/route";
import { issueTickets } from "@/features/tickets/tickets.server";
import {
  setEmailOutboxEffectWake,
  claimEmailOutboxBatch,
  finishEmailOutboxAttempt,
  hashEmailRecipient,
} from "@/lib/platform/email-outbox.server";
import { listCheckedInTeamParticipants } from "@/features/event-scoring/store/participants-teams.server";

describeWithDatabase("Sonder occurrence integration", () => {
  let orders: ReturnType<typeof sonderOrder>[] = [];
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await truncateAll();
    setEmailOutboxEffectWake(() => {});
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("AUTH_SECRET", "synthetic-test-secret-long-enough");
    vi.stubEnv("SONDER_MODE", "live");
    vi.stubEnv("SONDER_WEBHOOK_SIGNING_SECRET", "whsec_synthetic-only");
    vi.stubEnv("SONDER_WEBHOOK_API_KEY", "synthetic-read-key");
    vi.stubEnv("SONDER_TEAM_EMAILS_ENABLED", "true");
    for (const slug of ["sonder-night", "native-night"]) {
      const event = normaliseEventInput({
        slug,
        title: slug,
        area: "Synthetic test area",
        status: "published",
        startsAt: new Date(Date.now() + 86400_000).toISOString(),
        ticketTypes: [
          {
            id: "entry",
            name: "Entry",
            priceMinor: 0,
            currency: "GBP",
            quantity: 20,
            perPersonLimit: 10,
          },
        ],
      });
      if (!event.ok) throw new Error(event.error);
      await putEvent(event.value);
    }
    await configureSonderEvent("sonder-night", {
      hangoutId: HANGOUT,
      mode: "live",
      bookingUrl: "https://findsonder.app/synthetic-test",
      cancelledAt: null,
    });
    orders = [sonderOrder()];
    vi.stubGlobal("fetch", async () =>
      Response.json({
        mode: "live",
        hangout_id: HANGOUT,
        cancelled_at: null,
        orders,
        next_cursor: null,
      }),
    );
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setEmailOutboxEffectWake(null);
  });
  const sync = () => syncSonderEvent("sonder-night", new AbortController().signal);
  it("mirrors ticket/check-in figures without issuing native tickets; keeps booking groups together and allocation stable", async () => {
    orders = [
      sonderOrder(2),
      sonderOrder(
        1,
        "00000000-0000-4000-8000-000000000013",
        "00000000-0000-4000-8000-000000000015",
      ),
    ];
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const first = await readSonderEvent("sonder-night");
    expect(first?.counts.active).toBe(3);
    expect(first?.counts.unassigned).toBe(0);
    expect(await query(`select id from tickets where event_slug='sonder-night'`)).toHaveLength(0);
    expect(
      await query(
        `select distinct m.team_id from score_team_memberships m join sonder_tickets t on t.participant_id=m.participant_id where t.order_id=$1 and m.ends_at is null`,
        [ORDER_ID],
      ),
    ).toHaveLength(1);
    orders[0]!.tickets[0]!.status = "checked_in";
    await sync();
    expect((await readSonderEvent("sonder-night"))?.counts).toMatchObject({
      active: 3,
      checkedIn: 1,
    });
    expect((await readSonderEvent("sonder-night"))?.orders.map((o) => o.teamId)).toEqual(
      first?.orders.map((o) => o.teamId),
    );
    expect(await listCheckedInTeamParticipants("sonder-night")).toHaveLength(3);
  });
  it("blocks native issuance for the mapped occurrence while another event still issues native tickets", async () => {
    const input = {
      ticketTypeId: "entry",
      holderName: "Synthetic Buyer",
      email: "buyer@example.com",
      quantity: 1,
      kind: "free" as const,
    };
    expect(await issueTickets({ ...input, eventSlug: "sonder-night" })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await issueTickets({ ...input, eventSlug: "native-night" })).toMatchObject({ ok: true });
    await expect(
      configureSonderEvent("native-night", {
        hangoutId: randomUUID(),
        mode: "live",
        bookingUrl: "https://findsonder.app/synthetic-test",
        cancelledAt: null,
      }),
    ).rejects.toThrow();
    expect((await getEvent("native-night"))?.externalTicketing).toBeUndefined();
  });
  it("deduplicates verified deliveries and never acknowledges failed persistence", async () => {
    const raw = JSON.stringify({
        id: EVENT_ID,
        version: 1,
        type: "webhook.test",
        mode: "live",
        occurred_at: new Date().toISOString(),
        data: { message: "Connected to Sonder" },
      }),
      time = Math.floor(Date.now() / 1000);
    const header = `t=${time},v1=${createHmac("sha256", "whsec_synthetic-only")
      .update(time + ".")
      .update(raw)
      .digest("hex")}`;
    const request = () =>
      new Request("https://example.com/api/sonder/webhook", {
        method: "POST",
        headers: {
          "Sonder-Signature": header,
          "Sonder-Event-Id": EVENT_ID,
          "Content-Type": "application/json",
        },
        body: raw,
      });
    expect((await handleSonderWebhook(request())).status).toBe(200);
    expect(await (await handleSonderWebhook(request())).json()).toMatchObject({ duplicate: true });
    expect(await query(`select id from sonder_webhook_events`)).toHaveLength(1);
    await query(`alter table sonder_webhook_events rename to sonder_webhook_events_unavailable`);
    try {
      expect((await handleSonderWebhook(request())).status).toBe(503);
    } finally {
      await query(`alter table sonder_webhook_events_unavailable rename to sonder_webhook_events`);
    }
  });
  it("keeps cancellation latched across late events and inactivates every ticket for partial-refund review", async () => {
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    orders[0]!.review_required = true;
    orders[0]!.status = "needs_review";
    await sync();
    expect((await readSonderEvent("sonder-night"))?.counts.active).toBe(0);
    expect(
      await query(
        `select id from score_team_memberships where event_slug='sonder-night' and ends_at is null`,
      ),
    ).toHaveLength(0);
    await receiveSonderEvent(
      parseSonderEvent(
        {
          id: EVENT_ID,
          version: 1,
          type: "hangout.cancelled",
          mode: "live",
          occurred_at: new Date().toISOString(),
          data: { hangout_id: HANGOUT, cancelled_at: new Date().toISOString() },
        },
        EVENT_ID,
        "live",
      ),
    );
    orders[0]!.review_required = false;
    orders[0]!.status = "paid";
    await sync();
    expect((await readSonderEvent("sonder-night"))?.counts.active).toBe(0);
    expect((await getEvent("sonder-night"))?.status).toBe("cancelled");
    expect(
      await query(
        `select id from score_team_memberships where event_slug='sonder-night' and ends_at is null`,
      ),
    ).toHaveLength(0);
  });
  it("previews colour emails without QR codes, deduplicates sends and stops an obsolete queued email", async () => {
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const preview = await previewSonderTeamEmails("sonder-night");
    expect(preview.recipients[0]?.rendered.text).toContain("colour");
    expect(preview.recipients[0]?.rendered.html).not.toContain("sonder:ticket");
    expect(preview.recipients[0]?.rendered.html).not.toContain("mah1.");
    expect(await queueSonderTeamEmails("sonder-night", preview.revision)).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(await queueSonderTeamEmails("sonder-night", preview.revision)).toEqual({
      queued: 0,
      skipped: 0,
    });
    orders[0]!.review_required = true;
    orders[0]!.status = "needs_review";
    await sync();
    const deliver = vi.fn(async () => ({ ok: true as const, id: "synthetic-send" }));
    for (const row of await claimEmailOutboxBatch()) await finishEmailOutboxAttempt(row, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect((await query<{ status: string }>(`select status from email_outbox`))[0]?.status).toBe(
      "cancelled",
    );
  });
  it("retains last good figures and exposes a paused or rate-limited read instead of displaying zero", async () => {
    await sync();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 401 }));
    await expect(sync()).rejects.toThrow("paused");
    expect(await readSonderEvent("sonder-night")).toMatchObject({
      fresh: false,
      paused: true,
      counts: { active: 1 },
    });
  });
  it("does not resend team details for check-ins, but permits an approved team correction and correction back", async () => {
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const view = (await readSonderEvent("sonder-night"))!;
    const original = view.orders[0]!.teamId!;
    const other = view.teams.find((t) => t.id !== original)!.id;
    const deliver = vi.fn(async () => ({ ok: true as const, id: "synthetic-send" }));
    const send = async () => {
      const preview = await previewSonderTeamEmails("sonder-night");
      const result = await queueSonderTeamEmails("sonder-night", preview.revision);
      for (const row of await claimEmailOutboxBatch()) await finishEmailOutboxAttempt(row, deliver);
      return result.queued;
    };
    expect(await send()).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    orders[0]!.tickets[0]!.status = "checked_in";
    await sync();
    expect(await send()).toBe(0);
    await assignSonderBooking("sonder-night", ORDER_ID, other, "test-owner");
    expect(await send()).toBe(1);
    await assignSonderBooking("sonder-night", ORDER_ID, original, "test-owner");
    expect(await send()).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(3);
  });
  it("rejects stale previews and assignments, and disables sends until explicitly enabled", async () => {
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const preview = await previewSonderTeamEmails("sonder-night");
    await query(
      `update score_teams set name='Revised colour team' where event_slug='sonder-night'`,
    );
    await expect(queueSonderTeamEmails("sonder-night", preview.revision)).rejects.toThrow(
      "preview",
    );
    vi.stubEnv("SONDER_TEAM_EMAILS_ENABLED", "false");
    await expect(queueSonderTeamEmails("sonder-night", preview.revision)).rejects.toThrow(
      "disabled",
    );
    await query(`update sonder_event_links set last_sync_at=now()-interval '1 hour'`);
    const team = (await readSonderEvent("sonder-night"))!.teams[0]!.id;
    await expect(assignSonderBooking("sonder-night", ORDER_ID, team, "test-owner")).rejects.toThrow(
      "Sync",
    );
  });
  it("counts a moved ticket once and holds conflicting bookings for review", async () => {
    orders = [sonderOrder(2)];
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const moved = sonderOrder(1, "00000000-0000-4000-8000-000000000013");
    moved.tickets[0] = { ...orders[0]!.tickets[0]! };
    orders.push(moved);
    await sync();
    const view = (await readSonderEvent("sonder-night"))!;
    expect(view.counts.issued).toBe(2);
    expect(view.counts.active).toBe(0);
    expect(view.orders.every((o) => o.needsReview)).toBe(true);
    expect(await listCheckedInTeamParticipants("sonder-night")).toHaveLength(0);
  });
  it("scrubs old purchaser contacts and cancels unsent messages even without provider keys", async () => {
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    const preview = await previewSonderTeamEmails("sonder-night");
    await queueSonderTeamEmails("sonder-night", preview.revision);
    await query(
      `update events set starts_at=now()-interval '31 days',ends_at=null where slug='sonder-night'`,
    );
    vi.stubEnv("SONDER_WEBHOOK_API_KEY", "");
    await syncDueSonderEvents(new AbortController().signal);
    const view = (await readSonderEvent("sonder-night"))!;
    expect(view.orders[0]!.purchaser).toEqual({ name: null, email: "" });
    expect(view.paused).toBe(true);
    expect((await query<{ status: string }>(`select status from email_outbox`))[0]!.status).toBe(
      "cancelled",
    );
  });
  it("deactivates tickets omitted from a reduced booking and recovers an archived team as a whole group", async () => {
    orders = [sonderOrder(2)];
    await sync();
    await prepareSonderTeams("sonder-night", 3);
    await allocateSonderBookings("sonder-night", "test-owner");
    const team = (await readSonderEvent("sonder-night"))!.orders[0]!.teamId!;
    orders[0]!.quantity = 1;
    orders[0]!.tickets.splice(1);
    await sync();
    expect((await readSonderEvent("sonder-night"))!.counts).toMatchObject({
      issued: 2,
      active: 1,
      inactive: 1,
    });
    expect(await listCheckedInTeamParticipants("sonder-night")).toHaveLength(1);
    await query(`update score_teams set status='archived' where id=$1`, [team]);
    await sync();
    const unassigned = (await readSonderEvent("sonder-night"))!;
    expect(unassigned.orders[0]!.teamId).toBeNull();
    expect(unassigned.counts).toMatchObject({ active: 1, unassigned: 1, needsReview: 0 });
    await allocateSonderBookings("sonder-night", "test-owner");
    expect((await readSonderEvent("sonder-night"))!.counts.unassigned).toBe(0);
  });
  it("allows a resolved moved booking to be reviewed when the former owner is missing", async () => {
    await sync();
    const moved = sonderOrder(1, "00000000-0000-4000-8000-000000000013");
    moved.tickets[0] = { ...orders[0]!.tickets[0]! };
    orders = [moved];
    await sync();
    const booking = (await readSonderEvent("sonder-night"))!.orders.find(
      (o) => o.id === moved.order_id,
    )!;
    expect(booking.needsReview).toBe(true);
    await acknowledgeSonderOrder("sonder-night", booking.id, booking.revision, "test-owner");
    expect((await readSonderEvent("sonder-night"))!.counts.active).toBe(1);
  });
  it("skips a suppressed purchaser without rolling back other approved group emails", async () => {
    const second = sonderOrder(
      1,
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000015",
    );
    second.purchaser.email = "other@example.com";
    orders.push(second);
    await sync();
    await prepareSonderTeams("sonder-night", 2);
    await allocateSonderBookings("sonder-night", "test-owner");
    await query(
      `insert into email_suppressions(recipient_hash,reason,provider_message_id,first_occurred_at,last_occurred_at) values($1,'bounced','synthetic',now(),now())`,
      [hashEmailRecipient("buyer@example.com")],
    );
    // SQL timestamps retain microseconds; a rendered JS Date only has milliseconds.
    await query(`update events set updated_at=now() where slug='sonder-night'`);
    const preview = await previewSonderTeamEmails("sonder-night");
    expect(await queueSonderTeamEmails("sonder-night", preview.revision)).toEqual({
      queued: 1,
      skipped: 1,
    });
    const deliver = vi.fn(async () => ({ ok: true as const, id: "synthetic-send" }));
    for (const row of await claimEmailOutboxBatch()) await finishEmailOutboxAttempt(row, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("refuses a mapping in the wrong deployment mode before changing native ticketing", async () => {
    await expect(
      configureSonderEvent("native-night", {
        hangoutId: randomUUID(),
        mode: "test",
        bookingUrl: "https://findsonder.app/synthetic",
        cancelledAt: null,
      }),
    ).rejects.toThrow("mode");
    expect((await getEvent("native-night"))!.externalTicketing).toBeUndefined();
  });
  it("serializes a native issuance racing a Sonder provider mapping", async () => {
    await Promise.allSettled([
      configureSonderEvent("native-night", {
        hangoutId: randomUUID(),
        mode: "live",
        bookingUrl: "https://findsonder.app/synthetic",
        cancelledAt: null,
      }),
      issueTickets({
        eventSlug: "native-night",
        ticketTypeId: "entry",
        holderName: "Race fixture",
        email: "race@example.com",
        quantity: 1,
        kind: "free",
      }),
    ]);
    const event = (await getEvent("native-night"))!;
    const tickets = await query(`select id from tickets where event_slug='native-night'`);
    expect(Number(!!event.externalTicketing) + Number(tickets.length > 0)).toBe(1);
  });
});
