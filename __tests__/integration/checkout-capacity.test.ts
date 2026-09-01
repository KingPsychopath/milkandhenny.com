import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/platform/stripe.server", () => ({
  createCheckoutSession: stripe.createCheckoutSession,
  expireCheckoutSession: vi.fn(),
  isPaymentsConfigured: () => true,
  listPaymentRefunds: vi.fn().mockResolvedValue([]),
  refundPayment: vi.fn(),
  retrievePaymentBalance: vi.fn(),
  retrieveSession: vi.fn(),
}));

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { normaliseEventInput, updateEvent } from "@/features/events/events.server";
import { getEvent, putEvent } from "@/features/events/store.server";
import { getEventPage } from "@/features/event-operations/event-page.server";
import { getEventsIndex } from "@/features/event-operations/events-index.server";
import { getTicketCapacitySnapshot } from "@/features/tickets/capacity.server";
import { expireCheckout, startCheckout } from "@/features/tickets/checkout.server";
import { getEventTickets } from "@/features/tickets/tickets.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

async function seedEvent(
  input: { quantity?: number; capacity?: number; perPersonLimit?: number } = {},
) {
  const event = normaliseEventInput({
    slug: "capacity-night",
    title: "Capacity Night",
    status: "published",
    area: "East London",
    startsAt: FUTURE(),
    capacity: input.capacity,
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 1500,
        currency: "GBP",
        quantity: input.quantity ?? 1,
        perPersonLimit: input.perPersonLimit ?? 4,
      },
      {
        id: "vip",
        name: "VIP",
        priceMinor: 2500,
        currency: "GBP",
        quantity: 10,
        perPersonLimit: 4,
      },
    ],
  });
  if (!event.ok) throw new Error(event.error);
  await putEvent(event.value);
}

function checkoutInput(reference: string, email = "buyer@example.com", ticketTypeId = "entry") {
  return {
    eventSlug: "capacity-night",
    ticketTypeId,
    holderName: "Buyer",
    email,
    emailConfirmed: true,
    quantity: 1,
    origin: "https://example.com",
    acceptedTerms: true,
    marketingOptIn: false,
    checkoutRequestId: reference,
  };
}

describeWithDatabase("checkout capacity reservations (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    stripe.createCheckoutSession.mockReset();
  });

  it("rejects checkout before creating a payment when the address was not reviewed", async () => {
    const result = await startCheckout({
      ...checkoutInput("mistyped-email-reference", "anitjbraide@icloud.com"),
      emailConfirmed: false,
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Confirm where the ticket should be sent before continuing.",
    });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reserves the final ticket before Stripe and rejects a concurrent buyer", async () => {
    await seedEvent();
    let finishStripe!: (value: { id: string; url: string; expiresAt: string }) => void;
    stripe.createCheckoutSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStripe = resolve;
        }),
    );

    const first = startCheckout(checkoutInput("first-checkout-reference"));
    await vi.waitFor(() => expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1));

    const second = await startCheckout(
      checkoutInput("second-checkout-reference", "second@example.com"),
    );
    expect(second).toEqual({ ok: false, status: 409, error: "Sold out" });
    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);

    finishStripe({
      id: "cs_capacity_first_123",
      url: "https://checkout.stripe.test/first",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    expect((await first).ok).toBe(true);
    expect((await getTicketCapacitySnapshot("capacity-night")).checkoutReserved.entry).toBe(1);
    const adminSummary = await getEventTickets("capacity-night");
    expect(adminSummary.reserved).toBe(1);
    expect(adminSummary.checkouts).toEqual([
      expect.objectContaining({
        id: "cs_capacity_first_123",
        ticketTypeName: "Entry",
        quantity: 1,
        holderName: "Buyer",
        email: "buyer@example.com",
        status: "pending",
      }),
    ]);
    expect(adminSummary.byType.entry).toEqual(
      expect.objectContaining({ valid: 0, reserved: 1, remaining: 0 }),
    );
    const page = await getEventPage("capacity-night");
    expect(page?.soldOut).toBe(false);
    expect(page?.availability.find((entry) => entry.type.id === "entry")?.sales.state).toBe(
      "sold-out",
    );
    expect(
      (await getEventsIndex()).upcoming.find((event) => event.slug === "capacity-night"),
    ).toEqual(expect.objectContaining({ soldOut: false }));
  });

  it("blocks a restricted identity from starting a new purchase", async () => {
    await seedEvent({ quantity: 4 });
    const email = "restricted@example.com";
    await query(
      `insert into event_people
         (id,canonical_name,acquisition_status,acquisition_restricted_at,
          acquisition_restricted_by,acquisition_restriction_reason)
       values ($1,'Restricted person','restricted',now(),'root-owner','support review')`,
      ["0198e9d8-53d7-7db9-a8f5-b3bf86f59d8a"],
    );
    await query(
      `insert into event_person_identifiers
         (id,person_id,kind,value_hash,verified_at,display_hint)
       values ($1,$2,'email',$3,now(),'r•••@example.com')`,
      [
        "0198e9d8-53d7-7dba-98b2-025002b14968",
        "0198e9d8-53d7-7db9-a8f5-b3bf86f59d8a",
        createHash("sha256").update(email).digest("hex"),
      ],
    );

    expect(await startCheckout(checkoutInput("restricted-reference", email))).toEqual({
      ok: false,
      status: 403,
      error:
        "This email cannot buy new tickets. Existing tickets and orders are still available in your account.",
    });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("releases an expired Checkout hold", async () => {
    await seedEvent();
    stripe.createCheckoutSession.mockResolvedValueOnce({
      id: "cs_capacity_expiring_123",
      url: "https://checkout.stripe.test/expiring",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    expect((await startCheckout(checkoutInput("expiring-checkout-reference"))).ok).toBe(true);

    await expireCheckout("cs_capacity_expiring_123");
    expect((await getTicketCapacitySnapshot("capacity-night")).checkoutReserved.entry ?? 0).toBe(0);

    stripe.createCheckoutSession.mockResolvedValueOnce({
      id: "cs_capacity_replacement_123",
      url: "https://checkout.stripe.test/replacement",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    expect(
      (await startCheckout(checkoutInput("replacement-reference", "next@example.com"))).ok,
    ).toBe(true);
  });

  it("returns an existing held Checkout even if sales close before a retry", async () => {
    await seedEvent();
    stripe.createCheckoutSession.mockResolvedValueOnce({
      id: "cs_capacity_retry_123",
      url: "https://checkout.stripe.test/retry",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    const input = checkoutInput("retry-checkout-reference");
    expect((await startCheckout(input)).ok).toBe(true);

    await query(`update events set status = 'sold-out' where slug = $1`, ["capacity-night"]);
    expect(await startCheckout(input)).toEqual({
      ok: true,
      value: {
        url: "https://checkout.stripe.test/retry",
        sessionId: "cs_capacity_retry_123",
      },
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("does not let a crafted request buy a hidden ticket type", async () => {
    await seedEvent();
    await query(`update ticket_types set hidden = true where event_slug = $1 and id = $2`, [
      "capacity-night",
      "entry",
    ]);

    expect(await startCheckout(checkoutInput("hidden-checkout-reference"))).toEqual({
      ok: false,
      status: 404,
      error: "Ticket type not found",
    });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a fractional ticket quantity instead of silently rounding it", async () => {
    await seedEvent({ quantity: 4 });

    const result = await startCheckout({
      ...checkoutInput("fractional-checkout-reference"),
      quantity: 1.5,
    });

    expect(result).toEqual({ ok: false, status: 400, error: "Choose between 1 and 10" });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses the same ten-ticket boundary as post-payment issuance", async () => {
    await seedEvent({ quantity: 20, perPersonLimit: 20 });

    expect(
      await startCheckout({
        ...checkoutInput("over-checkout-order-limit"),
        quantity: 11,
      }),
    ).toEqual({ ok: false, status: 400, error: "Choose between 1 and 10" });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();

    stripe.createCheckoutSession.mockResolvedValueOnce({
      id: "cs_capacity_ten_123",
      url: "https://checkout.stripe.test/ten",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    expect(
      (
        await startCheckout({
          ...checkoutInput("exact-checkout-order-limit"),
          quantity: 10,
        })
      ).ok,
    ).toBe(true);
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 10 }),
    );
  });

  it("counts Checkout holds against event-wide and per-person limits", async () => {
    await seedEvent({ quantity: 10, capacity: 1, perPersonLimit: 1 });
    stripe.createCheckoutSession.mockResolvedValueOnce({
      id: "cs_capacity_event_123",
      url: "https://checkout.stripe.test/event",
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
    expect((await startCheckout(checkoutInput("event-cap-reference"))).ok).toBe(true);

    const otherType = await startCheckout(
      checkoutInput("other-type-reference", "second@example.com", "vip"),
    );
    expect(otherType).toEqual({ ok: false, status: 409, error: "Sold out" });

    const sameBuyer = await startCheckout(checkoutInput("same-buyer-reference"));
    expect(sameBuyer).toEqual({
      ok: false,
      status: 409,
      error: "Limit of 1 per person for Entry",
    });

    const page = await getEventPage("capacity-night");
    expect(page?.soldOut).toBe(true);
    expect(page?.availability.every((entry) => entry.sales.state === "sold-out")).toBe(true);
    expect(
      (await getEventsIndex()).upcoming.find((event) => event.slug === "capacity-night"),
    ).toEqual(expect.objectContaining({ soldOut: true }));
  });

  it("does not let an admin lower event or ticket-type capacity below active commitments", async () => {
    await seedEvent({ quantity: 2, capacity: 2 });
    stripe.createCheckoutSession
      .mockResolvedValueOnce({
        id: "cs_capacity_floor_entry_123",
        url: "https://checkout.stripe.test/entry",
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: "cs_capacity_floor_vip_123",
        url: "https://checkout.stripe.test/vip",
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      });
    expect((await startCheckout(checkoutInput("floor-entry-reference"))).ok).toBe(true);
    expect(
      (await startCheckout(checkoutInput("floor-vip-reference", "other@example.com", "vip"))).ok,
    ).toBe(true);

    const eventCapacity = await updateEvent("capacity-night", { capacity: 1 });
    expect(eventCapacity.ok).toBe(false);
    expect(!eventCapacity.ok && eventCapacity.status).toBe(409);

    const event = await getEvent("capacity-night");
    if (!event) throw new Error("event missing");
    const typeCapacity = await updateEvent("capacity-night", {
      ticketTypes: event.ticketTypes.map((type) =>
        type.id === "entry" ? { ...type, quantity: 0 } : type,
      ),
    });
    expect(typeCapacity.ok).toBe(false);
    expect(!typeCapacity.ok && typeCapacity.status).toBe(409);
  });
});
