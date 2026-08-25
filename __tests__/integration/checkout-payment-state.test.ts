import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

const stripe = vi.hoisted(() => ({
  refundPayment: vi.fn(),
  retrieveSession: vi.fn(),
}));

vi.mock("@/lib/platform/stripe.server", () => ({
  createCheckoutSession: vi.fn(),
  isPaymentsConfigured: () => true,
  listPaymentRefunds: vi.fn().mockResolvedValue([]),
  refundPayment: stripe.refundPayment,
  retrieveSession: stripe.retrieveSession,
}));

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { fulfilCheckout } from "@/features/tickets/checkout.server";
import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const SESSION_ID = "cs_test_payment_state";
const REFERENCE = "checkoutrequest123456";

async function seedPaidEvent(quantity = 1) {
  const result = normaliseEventInput({
    slug: "paid-night",
    title: "Paid Night",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 1500,
        currency: "GBP",
        quantity,
        perPersonLimit: 4,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
}

async function seedCheckout(amountMinor = 1500) {
  await query(
    `insert into checkout_sessions (
       id, event_slug, ticket_type_id, quantity, holder_name, email, email_hash,
       amount_minor, currency, reference, status
     ) values ($1,'paid-night','entry',1,'Buyer','buyer@example.com','hash',$2,'GBP',$3,'pending')`,
    [SESSION_ID, amountMinor, REFERENCE],
  );
}

function paidSession(amountMinor = 1500) {
  return {
    paid: true,
    status: "complete" as const,
    paymentIntentId: "pi_test_payment_state",
    amountMinor,
    currency: "gbp",
    email: "buyer@example.com",
    metadata: { checkoutReference: REFERENCE },
    amountRefundedMinor: 0,
    disputed: false,
  };
}

describeWithDatabase("checkout payment state (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    stripe.refundPayment.mockReset();
    stripe.retrieveSession.mockReset();
  });

  it("keeps an oversold checkout retryable when its refund request fails", async () => {
    await seedPaidEvent();
    const occupyingOrder = await issueTickets({
      eventSlug: "paid-night",
      ticketTypeId: "entry",
      holderName: "First buyer",
      email: "first@example.com",
      quantity: 1,
      kind: "paid",
      paymentRef: "pi_first",
      amountPaidMinor: 1500,
      currency: "GBP",
    });
    expect(occupyingOrder.ok).toBe(true);
    await seedCheckout();
    stripe.retrieveSession.mockResolvedValue(paidSession());
    stripe.refundPayment.mockResolvedValue({ ok: false, error: "Stripe unavailable" });

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result).toEqual({ outcome: "failed", error: "Stripe unavailable" });
    expect(
      await queryOne<{ status: string }>("select status from checkout_sessions where id = $1", [
        SESSION_ID,
      ]),
    ).toEqual({ status: "payment_pending" });
  });

  it("does not record a terminally failed automatic refund as pending", async () => {
    await seedPaidEvent();
    const occupyingOrder = await issueTickets({
      eventSlug: "paid-night",
      ticketTypeId: "entry",
      holderName: "First buyer",
      email: "first@example.com",
      quantity: 1,
      kind: "paid",
      paymentRef: "pi_first",
      amountPaidMinor: 1500,
      currency: "GBP",
    });
    expect(occupyingOrder.ok).toBe(true);
    await seedCheckout();
    stripe.retrieveSession.mockResolvedValue(paidSession());
    stripe.refundPayment.mockResolvedValue({
      ok: true,
      refundId: "re_failed",
      status: "failed",
      amountMinor: 1500,
    });

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result).toEqual({ outcome: "failed", error: "Stripe could not process the refund" });
    expect(
      await queryOne<{ status: string }>("select status from checkout_sessions where id = $1", [
        SESSION_ID,
      ]),
    ).toEqual({ status: "payment_pending" });
  });

  it("does not issue a ticket when Stripe's paid amount differs from the ledger", async () => {
    await seedPaidEvent();
    await seedCheckout();
    stripe.retrieveSession.mockResolvedValue(paidSession(1400));

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result).toEqual({
      outcome: "failed",
      error: "Paid session values do not match checkout",
    });
    expect(
      await queryOne<{ status: string }>("select status from checkout_sessions where id = $1", [
        SESSION_ID,
      ]),
    ).toEqual({ status: "payment_mismatch" });
  });

  it("waits for the async success event when checkout is not paid yet", async () => {
    await seedPaidEvent();
    await seedCheckout();
    stripe.retrieveSession.mockResolvedValue({ ...paidSession(), paid: false });

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result).toEqual({ outcome: "awaiting-payment" });
    expect(
      await queryOne<{ status: string }>("select status from checkout_sessions where id = $1", [
        SESSION_ID,
      ]),
    ).toEqual({ status: "payment_pending" });
  });

  it("honours a paid reservation when sales close while the buyer is at Stripe", async () => {
    await seedPaidEvent();
    await seedCheckout();
    await query(`update events set status = 'sold-out' where slug = 'paid-night'`);
    stripe.retrieveSession.mockResolvedValue(paidSession());

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result.outcome).toBe("issued");
    expect(
      await queryOne<{ status: string; ticket_type_id: string }>(
        `select status, ticket_type_id from tickets where checkout_ref = $1`,
        [SESSION_ID],
      ),
    ).toEqual({ status: "valid", ticket_type_id: "entry" });
  });

  it("recovers tickets created before an interrupted checkout ledger update", async () => {
    await seedPaidEvent();
    await seedCheckout();
    const issued = await issueTickets({
      eventSlug: "paid-night",
      ticketTypeId: "entry",
      holderName: "Buyer",
      email: "buyer@example.com",
      quantity: 1,
      kind: "paid",
      paymentRef: "pi_test_payment_state",
      checkoutRef: SESSION_ID,
      capacityHoldReference: REFERENCE,
      amountPaidMinor: 1500,
      currency: "GBP",
    });
    expect(issued.ok).toBe(true);
    await query(
      `update checkout_sessions
          set status = 'fulfilling', processing_started_at = now() - interval '3 minutes'
        where id = $1`,
      [SESSION_ID],
    );
    stripe.retrieveSession.mockResolvedValue(paidSession());

    const result = await fulfilCheckout(SESSION_ID, "https://example.com");

    expect(result).toEqual({ outcome: "already-issued" });
    expect(
      await queryOne<{ status: string; order_id: string | null }>(
        "select status, order_id from checkout_sessions where id = $1",
        [SESSION_ID],
      ),
    ).toEqual({
      status: "fulfilled",
      order_id: issued.ok ? issued.value.orderId : null,
    });
  });
});
