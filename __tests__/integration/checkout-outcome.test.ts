import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

/**
 * The confirmation page's data source.
 *
 * What matters here is that a buyer standing on the page after a redirect is
 * never told something worse than the truth: `pending` while the webhook is
 * in flight, the tickets once they exist, and a plain explanation when the
 * payment went somewhere else entirely.
 */

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

import { isCheckoutSessionId, resolveCheckoutOutcome } from "@/features/tickets/checkout.server";
import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const SESSION_ID = "cs_test_outcome_session";
const REFERENCE = "checkoutoutcome123456";
const ORIGIN = "https://example.com";

async function seedPaidEvent() {
  const result = normaliseEventInput({
    slug: "paid-night",
    title: "Paid Night",
    status: "published",
    area: "East London",
    venueName: "A flat",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 1500,
        currency: "GBP",
        quantity: 20,
        perPersonLimit: 4,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
}

/** `ageSeconds` backdates `updated_at` past the fulfilment nudge's throttle. */
async function seedCheckout(status = "pending", quantity = 2, ageSeconds = 0) {
  await query(
    `insert into checkout_sessions (
       id, event_slug, ticket_type_id, quantity, holder_name, email, email_hash,
       amount_minor, currency, reference, status, updated_at
     ) values ($1,'paid-night','entry',$2,'Buyer','buyer@example.com','hash',
               $3,'GBP',$4,$5, now() - ($6 || ' seconds')::interval)`,
    [SESSION_ID, quantity, 1500 * quantity, REFERENCE, status, String(ageSeconds)],
  );
}

function paidSession(quantity = 2) {
  return {
    paid: true,
    paymentIntentId: "pi_test_outcome",
    amountMinor: 1500 * quantity,
    currency: "gbp",
    email: "buyer@example.com",
    metadata: { checkoutReference: REFERENCE },
    amountRefundedMinor: 0,
    disputed: false,
  };
}

it("rejects anything that is not a Stripe session id before touching the database", () => {
  expect(isCheckoutSessionId("cs_test_a1b2c3d4e5f6")).toBe(true);
  expect(isCheckoutSessionId("cs_short")).toBe(false);
  expect(isCheckoutSessionId("tkt_abcdefghijklmno")).toBe(false);
  expect(isCheckoutSessionId("cs_test_'; drop table tickets; --")).toBe(false);
  expect(isCheckoutSessionId(undefined)).toBe(false);
});

describeWithDatabase("checkout outcome (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    stripe.refundPayment.mockReset();
    stripe.retrieveSession.mockReset();
  });

  it("reports an unrecognised session rather than inventing one", async () => {
    expect(await resolveCheckoutOutcome("cs_test_never_existed_here", ORIGIN)).toEqual({
      state: "unknown",
    });
  });

  it("waits rather than nudging a checkout that was only just created", async () => {
    await seedPaidEvent();
    await seedCheckout("pending", 2, 0);

    expect(await resolveCheckoutOutcome(SESSION_ID, ORIGIN)).toEqual({ state: "pending" });
    // The webhook owns issuance; a redirect arriving first must not race it.
    expect(stripe.retrieveSession).not.toHaveBeenCalled();
  });

  it("issues the tickets itself when the webhook has not landed", async () => {
    await seedPaidEvent();
    await seedCheckout("pending", 2, 30);
    stripe.retrieveSession.mockResolvedValue(paidSession());

    const outcome = await resolveCheckoutOutcome(SESSION_ID, ORIGIN);

    expect(outcome.state).toBe("complete");
    if (outcome.state !== "complete") return;
    expect(outcome.tickets).toHaveLength(2);
    expect(outcome.amountMinor).toBe(3000);
    expect(outcome.email).toBe("buyer@example.com");
    expect(outcome.event.venueName).toBe("A flat");
    // One purchaser ticket; the rest hang off it, and only it manages the order.
    expect(outcome.tickets.filter((ticket) => !ticket.parentTicketId)).toHaveLength(1);
  });

  it("never issues tickets for a session Stripe says is unpaid", async () => {
    await seedPaidEvent();
    await seedCheckout("pending", 2, 30);
    stripe.retrieveSession.mockResolvedValue({ ...paidSession(), paid: false });

    expect(await resolveCheckoutOutcome(SESSION_ID, ORIGIN)).toEqual({ state: "pending" });
    const rows = await query<{ count: string }>("select count(*) as count from tickets");
    expect(rows[0].count).toBe("0");
  });

  it("returns the same tickets on a repeat load without issuing more", async () => {
    await seedPaidEvent();
    await seedCheckout("pending", 2, 30);
    stripe.retrieveSession.mockResolvedValue(paidSession());

    const first = await resolveCheckoutOutcome(SESSION_ID, ORIGIN);
    const second = await resolveCheckoutOutcome(SESSION_ID, ORIGIN);

    expect(first.state).toBe("complete");
    expect(second.state).toBe("complete");
    if (first.state !== "complete" || second.state !== "complete") return;
    expect(second.tickets.map((ticket) => ticket.id)).toEqual(
      first.tickets.map((ticket) => ticket.id),
    );
    const rows = await query<{ count: string }>("select count(*) as count from tickets");
    expect(rows[0].count).toBe("2");
  });

  it("explains a settled payment instead of spinning on it", async () => {
    await seedPaidEvent();
    await seedCheckout("refunded", 2, 30);

    const outcome = await resolveCheckoutOutcome(SESSION_ID, ORIGIN);

    expect(outcome.state).toBe("problem");
    if (outcome.state !== "problem") return;
    expect(outcome.message).toMatch(/refunded/i);
    expect(stripe.retrieveSession).not.toHaveBeenCalled();
  });

  it("does not leave a fulfilled-but-orderless row claiming to be complete", async () => {
    await seedPaidEvent();
    await seedCheckout("pending", 2, 30);
    await query(`update checkout_sessions set status = 'fulfilled' where id = $1`, [SESSION_ID]);

    expect(await resolveCheckoutOutcome(SESSION_ID, ORIGIN)).toEqual({ state: "pending" });
  });
});
