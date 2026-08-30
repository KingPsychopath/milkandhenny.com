import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * Integration tests for issuance and door redemption, against real Postgres.
 *
 * The two properties that decide whether a real door works are asserted
 * directly: a ticket admits exactly once under simultaneous scans, and
 * capacity cannot be oversold by simultaneous buyers. Both are guarantees of
 * the database — a row lock and a `where redeemed_at is null` predicate — so
 * they are tested against a real one.
 */

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

// Rate limiting still lives on Redis; disable it so it cannot mask a result.
vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";
import { putEvent } from "@/features/events/store.server";
import { normaliseEventInput } from "@/features/events/events.server";
import {
  buildDoorManifest,
  getEventTickets,
  getTicketHolderNames,
  issueTickets,
  redeemTicket,
  unredeemTicket,
  voidTicket,
} from "@/features/tickets/tickets.server";
import {
  getSoldCounts,
  markOrderDisputed,
  markOrderRefunded,
  restoreDisputedTickets,
  insertTicketsWithCapacity,
  updateTicketHolder,
} from "@/features/tickets/store.server";
import { participantForTicket } from "@/features/event-scoring/store.server";
import {
  buildTicketQrPayload,
  generateTicketId,
  hashTicketId,
  signTicketId,
} from "@/features/tickets/qr.server";
import { refundOrder } from "@/features/tickets/checkout.server";
import {
  checkpointScan,
  undoCheckpointUse,
  upsertCheckpoint,
} from "@/features/tickets/checkpoints.server";
import type { EventRecord } from "@/features/events/types";
import { query } from "@/lib/platform/postgres.server";

const SLUG = "apartment-life";

async function seedEvent(quantity = 5, perPersonLimit = 4): Promise<EventRecord> {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Apartment Life",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      { id: "entry", name: "Entry", priceMinor: 0, currency: "GBP", quantity, perPersonLimit },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
  return result.value;
}

async function issueOne(name = "Alice") {
  const result = await issueTickets({
    eventSlug: SLUG,
    ticketTypeId: "entry",
    holderName: name,
    quantity: 1,
    kind: "free",
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.tickets[0];
}

describeWithDatabase("tickets (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe("issuance", () => {
    it("issues a ticket for a published event", async () => {
      await seedEvent();
      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "alice@example.com",
        quantity: 1,
        kind: "free",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tickets).toHaveLength(1);
      expect(result.value.tickets[0].holderName).toBe("Alice");
      expect(result.value.tickets[0].status).toBe("valid");
      // Indexed by hash; the raw address is kept only for delivery.
      expect(result.value.tickets[0].emailHash).toBeTruthy();
      expect(result.value.tickets[0].email).toBe("alice@example.com");
    });

    it("issues plus-ones linked to the first ticket", async () => {
      await seedEvent();
      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "alice@example.com",
        quantity: 3,
        kind: "free",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [first, ...rest] = result.value.tickets;
      expect(rest).toHaveLength(2);
      expect(first.parentTicketId).toBeUndefined();
      for (const ticket of rest) expect(ticket.parentTicketId).toBe(first.id);
      expect(new Set(result.value.tickets.map((t) => t.orderId)).size).toBe(1);
    });

    it("keeps a corrected ticket label and its private participant name in sync", async () => {
      await seedEvent();
      const ticket = await issueOne("Alyce");

      await updateTicketHolder(ticket.id, { holderName: "Alice Smith" });

      expect((await participantForTicket(ticket.id))?.displayName).toBe("Alice Smith");
    });

    it("does not let a shared child ticket refund the purchaser's order", async () => {
      await seedEvent();
      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "alice@example.com",
        quantity: 2,
        kind: "paid",
        paymentRef: "pi_shared_child",
        amountPaidMinor: 1000,
        currency: "GBP",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outcome = await refundOrder({
        ticketId: result.value.tickets[1].id,
        reason: "self-serve",
      });

      expect(outcome).toEqual({
        ok: false,
        status: 403,
        error: "Only the purchaser ticket can refund this order",
      });
    });

    it("rejects an unknown event or ticket type", async () => {
      await seedEvent();
      expect(
        (
          await issueTickets({
            eventSlug: "nope",
            ticketTypeId: "entry",
            holderName: "A",
            quantity: 1,
            kind: "free",
          })
        ).ok,
      ).toBe(false);

      expect(
        (
          await issueTickets({
            eventSlug: SLUG,
            ticketTypeId: "vip",
            holderName: "A",
            quantity: 1,
            kind: "free",
          })
        ).ok,
      ).toBe(false);
    });

    it("rejects a fractional quantity instead of silently issuing a rounded count", async () => {
      await seedEvent();

      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        quantity: 1.5,
        kind: "free",
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: "Choose between 1 and 10",
      });
    });

    it("accepts ten tickets but rejects eleven before issuance", async () => {
      await seedEvent(20, 20);

      expect(
        await issueTickets({
          eventSlug: SLUG,
          ticketTypeId: "entry",
          holderName: "Alice",
          quantity: 11,
          kind: "free",
        }),
      ).toEqual({ ok: false, status: 400, error: "Choose between 1 and 10" });

      const accepted = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        quantity: 10,
        kind: "free",
      });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.tickets).toHaveLength(10);
    });

    it("enforces the per-person limit", async () => {
      await seedEvent(50, 4);
      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Greedy",
        quantity: 5,
        kind: "free",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/limit/i);
    });

    it("enforces the per-person limit across separate orders", async () => {
      await seedEvent(50, 2);
      const first = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "alice@example.com",
        quantity: 2,
        kind: "free",
      });
      expect(first.ok).toBe(true);

      const second = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "alice@example.com",
        quantity: 1,
        kind: "free",
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toMatch(/limit/i);
    });

    it("writes nothing when the email is malformed", async () => {
      await seedEvent();
      const result = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        email: "not-an-email",
        quantity: 1,
        kind: "free",
      });
      expect(result.ok).toBe(false);
      expect((await getEventTickets(SLUG)).total).toBe(0);
    });
  });

  describe("capacity", () => {
    it("enforces the event-wide cap across ticket types", async () => {
      const result = normaliseEventInput({
        slug: SLUG,
        title: "Apartment Life",
        status: "published",
        area: "East London",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        capacity: 3,
        ticketTypes: [
          {
            id: "entry",
            name: "Entry",
            priceMinor: 0,
            currency: "GBP",
            quantity: 10,
            perPersonLimit: 10,
          },
          {
            id: "guest",
            name: "Guest",
            priceMinor: 0,
            currency: "GBP",
            quantity: 10,
            perPersonLimit: 10,
          },
        ],
      });
      if (!result.ok) throw new Error(result.error);
      await putEvent(result.value);

      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          issueTickets({
            eventSlug: SLUG,
            ticketTypeId: index % 2 === 0 ? "entry" : "guest",
            holderName: `Guest ${index}`,
            quantity: 1,
            kind: "free",
          }),
        ),
      );

      expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(3);
      expect((await getEventTickets(SLUG)).valid).toBe(3);
    });

    it("does not oversell when buyers arrive at the same instant", async () => {
      await seedEvent(3);

      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          issueTickets({
            eventSlug: SLUG,
            ticketTypeId: "entry",
            holderName: `Guest ${index}`,
            quantity: 1,
            kind: "free",
          }),
        ),
      );

      expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(3);
      expect((await getEventTickets(SLUG)).total).toBe(3);
      expect((await getSoldCounts(SLUG)).entry).toBe(3);
    });

    it("does not oversell with mixed group sizes racing for the last seats", async () => {
      await seedEvent(4);

      const attempts = await Promise.all([
        issueTickets({
          eventSlug: SLUG,
          ticketTypeId: "entry",
          holderName: "A",
          quantity: 3,
          kind: "free",
        }),
        issueTickets({
          eventSlug: SLUG,
          ticketTypeId: "entry",
          holderName: "B",
          quantity: 3,
          kind: "free",
        }),
        issueTickets({
          eventSlug: SLUG,
          ticketTypeId: "entry",
          holderName: "C",
          quantity: 2,
          kind: "free",
        }),
      ]);

      const issued = (await getEventTickets(SLUG)).total;
      expect(issued).toBeLessThanOrEqual(4);
      // Partial orders are never written — each attempt is all or nothing.
      const succeeded = attempts.filter((a) => a.ok);
      const expected = succeeded.reduce((sum, a) => sum + (a.ok ? a.value.tickets.length : 0), 0);
      expect(issued).toBe(expected);
    });

    it("returns a seat to the pool when a ticket is refunded", async () => {
      await seedEvent(1);
      const first = await issueOne("Alice");

      expect(
        (
          await issueTickets({
            eventSlug: SLUG,
            ticketTypeId: "entry",
            holderName: "Bob",
            quantity: 1,
            kind: "free",
          })
        ).ok,
      ).toBe(false);

      await voidTicket(first.id, "refunded");

      expect(
        (
          await issueTickets({
            eventSlug: SLUG,
            ticketTypeId: "entry",
            holderName: "Bob",
            quantity: 1,
            kind: "free",
          })
        ).ok,
      ).toBe(true);
    });

    it("requires an explicit capacity override for a comp past a full house", async () => {
      await seedEvent(1);
      await issueOne("Alice");

      const refused = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Guest of honour",
        quantity: 1,
        kind: "comp",
        bypassSalesWindow: true,
      });
      expect(refused.ok).toBe(false);

      const comped = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Guest of honour",
        quantity: 1,
        kind: "comp",
        bypassSalesWindow: true,
        bypassCapacity: true,
      });
      expect(comped.ok).toBe(true);
    });
  });

  describe("redemption", () => {
    it("admits a valid ticket once", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const outcome = await redeemTicket({
        scanned: buildTicketQrPayload(ticket.id),
        eventSlug: SLUG,
        redeemedBy: "door-1",
      });
      expect(outcome.result).toBe("admitted");
    });

    it("reports a second scan as already redeemed", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const payload = buildTicketQrPayload(ticket.id);

      const first = await redeemTicket({ scanned: payload, eventSlug: SLUG });
      const second = await redeemTicket({ scanned: payload, eventSlug: SLUG });

      expect(first.result).toBe("admitted");
      expect(second.result).toBe("already-redeemed");
      if (second.result === "already-redeemed") expect(second.redeemedAt).toBeTruthy();
    });

    it("admits exactly once when two door devices scan simultaneously", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const payload = buildTicketQrPayload(ticket.id);

      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => redeemTicket({ scanned: payload, eventSlug: SLUG })),
      );

      expect(outcomes.filter((o) => o.result === "admitted")).toHaveLength(1);
      expect(outcomes.filter((o) => o.result === "already-redeemed")).toHaveLength(7);
    });

    it("rejects a forged signature", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const genuine = signTicketId(ticket.id);
      const forged = `${genuine.slice(0, -1)}${genuine.endsWith("A") ? "B" : "A"}`;

      const outcome = await redeemTicket({
        scanned: `mah1.${ticket.id}.${forged}`,
        eventSlug: SLUG,
      });
      expect(outcome.result).toBe("invalid");
    });

    it("uses only the rotated public reference at every door boundary", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const publicId = generateTicketId();
      await query(`update tickets set access_reference = $2 where id = $1`, [ticket.id, publicId]);

      const summaryTicket = (await getEventTickets(SLUG)).tickets.find(
        ({ id }) => id === ticket.id,
      );
      expect(summaryTicket).toMatchObject({ id: ticket.id, publicId });
      expect((await buildDoorManifest(SLUG)).hashes).toContain(hashTicketId(publicId));
      expect((await buildDoorManifest(SLUG)).hashes).not.toContain(hashTicketId(ticket.id));

      expect(
        (await redeemTicket({ scanned: buildTicketQrPayload(ticket.id), eventSlug: SLUG })).result,
      ).toBe("invalid");
      const admitted = await redeemTicket({
        scanned: buildTicketQrPayload(publicId),
        eventSlug: SLUG,
      });
      expect(admitted).toMatchObject({
        result: "admitted",
        ticket: { id: ticket.id, holderName: ticket.holderName },
      });
    });

    it("undoes checkpoint use through a rotated public reference", async () => {
      await seedEvent();
      const checkpoint = await upsertCheckpoint({
        eventSlug: SLUG,
        id: "welcome-drink",
        name: "Welcome drink",
        defaultAllowance: 1,
        allowances: {},
      });
      expect(checkpoint.ok).toBe(true);
      const ticket = await issueOne();
      const publicId = generateTicketId();
      await query(`update tickets set access_reference = $2 where id = $1`, [ticket.id, publicId]);

      expect(
        await checkpointScan({
          scanned: buildTicketQrPayload(publicId),
          eventSlug: SLUG,
          checkpointId: "welcome-drink",
        }),
      ).toMatchObject({ result: "consumed", ticket: { ticketId: publicId, used: 1 } });
      await expect(
        undoCheckpointUse({
          eventSlug: SLUG,
          checkpointId: "welcome-drink",
          ticketId: publicId,
        }),
      ).resolves.toEqual({ ok: true, value: { used: 0 } });
    });

    it("rejects a ticket issued for a different event", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const outcome = await redeemTicket({
        scanned: buildTicketQrPayload(ticket.id),
        eventSlug: "some-other-night",
      });
      expect(outcome.result).toBe("wrong-event");
    });

    it("rejects a voided ticket", async () => {
      await seedEvent();
      const ticket = await issueOne();
      await voidTicket(ticket.id);
      const outcome = await redeemTicket({
        scanned: buildTicketQrPayload(ticket.id),
        eventSlug: SLUG,
      });
      expect(outcome.result).toBe("void");
    });

    it("reports an unknown but well-formed ticket as not found", async () => {
      await seedEvent();
      const outcome = await redeemTicket({ scanned: "ABCDEFGHJKMNPQRS", eventSlug: SLUG });
      expect(outcome.result).toBe("not-found");
    });

    it("lets staff undo an accidental scan", async () => {
      await seedEvent();
      const ticket = await issueOne();
      const payload = buildTicketQrPayload(ticket.id);

      expect((await redeemTicket({ scanned: payload, eventSlug: SLUG })).result).toBe("admitted");
      expect((await participantForTicket(ticket.id))?.checkedInAt).toBeDefined();
      await unredeemTicket(ticket.id);
      expect((await participantForTicket(ticket.id))?.checkedInAt).toBeUndefined();
      expect((await redeemTicket({ scanned: payload, eventSlug: SLUG })).result).toBe("admitted");
    });
  });

  describe("refunds", () => {
    /** Three £15 tickets on one payment, each carrying its own share. */
    async function issuePaidOrder() {
      await seedEvent(10);
      const outcome = await insertTicketsWithCapacity(
        {
          eventSlug: SLUG,
          ticketTypeId: "entry",
          kind: "paid",
          orderId: "ord_test",
          paymentRef: "pi_test_123",
          amountPaidMinor: 1500,
          currency: "GBP",
        },
        [
          { id: "AAAAAAAAAAAAAAAA", holderName: "Buyer" },
          { id: "BBBBBBBBBBBBBBBB", holderName: "Buyer +1" },
          { id: "CCCCCCCCCCCCCCCC", holderName: "Buyer +2" },
        ],
      );
      expect(outcome.ok).toBe(true);
    }

    it("voids the whole order for a full refund", async () => {
      await issuePaidOrder();
      const voided = await markOrderRefunded("pi_test_123", "re_1", 4500);
      expect(voided).toHaveLength(3);
      expect((await getSoldCounts(SLUG)).entry ?? 0).toBe(0);
    });

    it("voids only what a partial refund covers", async () => {
      await issuePaidOrder();
      // One ticket's worth back — the other two are still paid for.
      const voided = await markOrderRefunded("pi_test_123", "re_2", 1500);
      expect(voided).toHaveLength(1);
      expect((await getSoldCounts(SLUG)).entry).toBe(2);
      const summary = await getEventTickets(SLUG);
      expect(summary.total).toBe(3);
      expect(summary.valid).toBe(2);
      expect(summary.refunded).toBe(1);
      expect(summary.grossMinor).toBe(4500);
      expect(summary.netMinor).toBe(3000);
      expect(summary.tickets.find((ticket) => ticket.status === "refunded")?.refundedAt).toEqual(
        expect.any(String),
      );
    });

    it("voids two when two tickets' worth is refunded", async () => {
      await issuePaidOrder();
      const voided = await markOrderRefunded("pi_test_123", "re_3", 3000);
      expect(voided).toHaveLength(2);
      expect((await getSoldCounts(SLUG)).entry).toBe(1);
    });

    it("uses the cumulative total for repeated partial refunds", async () => {
      await issuePaidOrder();
      expect(await markOrderRefunded("pi_test_123", "re_1", 1500)).toHaveLength(1);
      expect(await markOrderRefunded("pi_test_123", "re_2", 3000)).toHaveLength(1);

      const summary = await getEventTickets(SLUG);
      expect(summary.valid).toBe(1);
      expect(summary.refunded).toBe(2);
      expect(summary.netMinor).toBe(1500);
    });

    it("treats an unknown amount as a full refund", async () => {
      await issuePaidOrder();
      expect(await markOrderRefunded("pi_test_123", "re_4")).toHaveLength(3);
    });

    it("restores tickets when a dispute is won, but not genuine refunds", async () => {
      await issuePaidOrder();

      // A dispute voids without setting refunded_at.
      await markOrderDisputed("pi_test_123", "dp_1");
      expect((await getSoldCounts(SLUG)).entry ?? 0).toBe(0);

      const restored = await restoreDisputedTickets("pi_test_123", "dp_1");
      expect(restored).toHaveLength(3);
      expect((await getSoldCounts(SLUG)).entry).toBe(3);
    });

    it("does not restore under a different dispute reference", async () => {
      await issuePaidOrder();
      await markOrderDisputed("pi_test_123", "dp_1");
      expect(await restoreDisputedTickets("pi_test_123", "dp_other")).toHaveLength(0);
    });
  });

  describe("door manifest", () => {
    it("contains hashes rather than ticket ids", async () => {
      await seedEvent();
      const issued = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        quantity: 2,
        kind: "free",
      });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      const manifest = await buildDoorManifest(SLUG);
      expect(manifest.hashes).toHaveLength(2);
      for (const ticket of issued.value.tickets) {
        expect(manifest.hashes).toContain(hashTicketId(ticket.id));
        // A stolen manifest must not be a forgery kit.
        expect(manifest.hashes).not.toContain(ticket.id);
      }
    });

    it("omits voided tickets", async () => {
      await seedEvent();
      const ticket = await issueOne();
      await voidTicket(ticket.id);
      expect((await buildDoorManifest(SLUG)).hashes).toHaveLength(0);
    });
  });

  describe("summaries", () => {
    it("counts issued and redeemed per type", async () => {
      await seedEvent();
      const issued = await issueTickets({
        eventSlug: SLUG,
        ticketTypeId: "entry",
        holderName: "Alice",
        quantity: 2,
        kind: "free",
      });
      if (!issued.ok) return;

      await redeemTicket({
        scanned: buildTicketQrPayload(issued.value.tickets[0].id),
        eventSlug: SLUG,
      });

      const summary = await getEventTickets(SLUG);
      expect(summary.total).toBe(2);
      expect(summary.redeemed).toBe(1);
      expect(summary.byType.entry.issued).toBe(2);
      expect(summary.byType.entry.redeemed).toBe(1);
    });

    it("lists holder names for best-dressed voting", async () => {
      await seedEvent();
      await issueOne("Zoe");
      await issueOne("Alice");
      expect(await getTicketHolderNames(SLUG)).toEqual(["Alice", "Zoe"]);
    });
  });
});
