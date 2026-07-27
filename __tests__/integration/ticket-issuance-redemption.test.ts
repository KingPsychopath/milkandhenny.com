import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for issuance and door redemption.
 *
 * The two properties that matter most at a real door are covered directly:
 * a ticket admits exactly once, and capacity cannot be oversold by
 * concurrent claims.
 */

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { __resetEventMemoryStore, putEvent } from "@/features/events/store.server";
import { __resetTicketMemoryStore } from "@/features/tickets/store.server";
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
import { buildTicketQrPayload, hashTicketId, signTicketId } from "@/features/tickets/qr.server";
import type { EventRecord } from "@/features/events/types";

const SLUG = "apartment-life";

async function seedEvent(quantity = 5): Promise<EventRecord> {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Apartment Life",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity,
        perPersonLimit: 4,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
  return result.value;
}

beforeEach(async () => {
  __resetEventMemoryStore();
  __resetTicketMemoryStore();
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
    expect(result.value.tickets[0].emailHash).toBeTruthy();
    // The raw address is stored for delivery, but indexes use the hash.
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
    // All share one order so a resend delivers the whole group.
    expect(new Set(result.value.tickets.map((t) => t.orderId)).size).toBe(1);
  });

  it("rejects an unknown event or ticket type", async () => {
    await seedEvent();
    const missingEvent = await issueTickets({
      eventSlug: "nope",
      ticketTypeId: "entry",
      holderName: "A",
      quantity: 1,
      kind: "free",
    });
    expect(missingEvent.ok).toBe(false);

    const missingType = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "vip",
      holderName: "A",
      quantity: 1,
      kind: "free",
    });
    expect(missingType.ok).toBe(false);
  });

  it("enforces the per-person limit", async () => {
    await seedEvent(50);
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

  it("rejects a malformed email before issuing anything", async () => {
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
  it("does not oversell when claims arrive concurrently", async () => {
    await seedEvent(3);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        issueTickets({
          eventSlug: SLUG,
          ticketTypeId: "entry",
          holderName: `Guest ${index}`,
          quantity: 1,
          kind: "free",
        }),
      ),
    );

    const issued = attempts.filter((attempt) => attempt.ok);
    expect(issued).toHaveLength(3);
    expect((await getEventTickets(SLUG)).total).toBe(3);
  });

  it("releases capacity when a ticket is voided", async () => {
    await seedEvent(1);
    const first = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Alice",
      quantity: 1,
      kind: "free",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Sold out.
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

    await voidTicket(first.value.tickets[0].id, "refunded");

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
});

describe("redemption", () => {
  async function issueOne(name = "Alice") {
    await seedEvent();
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

  it("admits a valid ticket once", async () => {
    const ticket = await issueOne();
    const outcome = await redeemTicket({
      scanned: buildTicketQrPayload(ticket.id),
      eventSlug: SLUG,
      redeemedBy: "door-1",
    });
    expect(outcome.result).toBe("admitted");
  });

  it("reports a second scan as already redeemed, not as a new admission", async () => {
    const ticket = await issueOne();
    const payload = buildTicketQrPayload(ticket.id);

    const first = await redeemTicket({ scanned: payload, eventSlug: SLUG });
    const second = await redeemTicket({ scanned: payload, eventSlug: SLUG });

    expect(first.result).toBe("admitted");
    expect(second.result).toBe("already-redeemed");
    if (second.result === "already-redeemed") {
      expect(second.redeemedAt).toBeTruthy();
    }
  });

  it("admits exactly once when two door devices scan simultaneously", async () => {
    const ticket = await issueOne();
    const payload = buildTicketQrPayload(ticket.id);

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => redeemTicket({ scanned: payload, eventSlug: SLUG })),
    );

    expect(outcomes.filter((outcome) => outcome.result === "admitted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.result === "already-redeemed")).toHaveLength(5);
  });

  it("rejects a forged signature", async () => {
    const ticket = await issueOne();
    const genuine = signTicketId(ticket.id);
    const forged = `${genuine.slice(0, -1)}${genuine.endsWith("A") ? "B" : "A"}`;

    const outcome = await redeemTicket({
      scanned: `mah1.${ticket.id}.${forged}`,
      eventSlug: SLUG,
    });
    expect(outcome.result).toBe("invalid");
  });

  it("rejects a ticket issued for a different event", async () => {
    const ticket = await issueOne();
    const outcome = await redeemTicket({
      scanned: buildTicketQrPayload(ticket.id),
      eventSlug: "some-other-night",
    });
    expect(outcome.result).toBe("wrong-event");
  });

  it("rejects a voided ticket", async () => {
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
    const outcome = await redeemTicket({
      scanned: "ABCDEFGHJKMNPQRS",
      eventSlug: SLUG,
    });
    expect(outcome.result).toBe("not-found");
  });

  it("lets staff undo an accidental scan", async () => {
    const ticket = await issueOne();
    const payload = buildTicketQrPayload(ticket.id);

    expect((await redeemTicket({ scanned: payload, eventSlug: SLUG })).result).toBe("admitted");
    await unredeemTicket(ticket.id);
    expect((await redeemTicket({ scanned: payload, eventSlug: SLUG })).result).toBe("admitted");
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
      // A stolen manifest must not be a ticket forgery kit.
      expect(manifest.hashes).not.toContain(ticket.id);
    }
  });

  it("omits voided tickets", async () => {
    await seedEvent();
    const issued = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Alice",
      quantity: 1,
      kind: "free",
    });
    if (!issued.ok) return;

    await voidTicket(issued.value.tickets[0].id);
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
    await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Zoe",
      quantity: 1,
      kind: "free",
    });
    await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Alice",
      quantity: 1,
      kind: "free",
    });

    expect(await getTicketHolderNames(SLUG)).toEqual(["Alice", "Zoe"]);
  });
});
