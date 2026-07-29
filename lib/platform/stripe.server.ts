import Stripe from "stripe";

import { log } from "./logger.server";

/**
 * Provider-neutral payments adapter.
 *
 * Same posture as the Redis, storage and email adapters: the application
 * contract is `STRIPE_*`, and the rest of the codebase talks to the small
 * surface below rather than to Stripe types.
 *
 * Hosted Checkout is used deliberately. It surfaces Apple Pay and Google Pay
 * without extra work, and it means no card data ever reaches this codebase —
 * which keeps the PCI surface at zero.
 */

let client: Stripe | null = null;

/**
 * Stripe's two secrets are easy to transpose, and the failure is silent:
 * a webhook secret in `STRIPE_SECRET_KEY` leaves the app looking configured
 * while every API call 401s at the moment someone tries to buy. Both are
 * shape-checked so the mistake surfaces on `/health` instead.
 */
const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9+/=_-]+$/;

export function getStripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key && SECRET_KEY_PATTERN.test(key) ? key : null;
}

export function getWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return secret && WEBHOOK_SECRET_PATTERN.test(secret) ? secret : null;
}

/** Distinguishes "not set" from "set to something that isn't a Stripe key". */
function describeMisconfiguration(name: string, pattern: RegExp, expected: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  return pattern.test(raw) ? null : `${name} is set but doesn't look like ${expected}`;
}

export function isPaymentsConfigured(): boolean {
  return getStripeSecretKey() !== null && getWebhookSecret() !== null;
}

/** `true` while pointed at test keys — surfaced in admin so it is obvious. */
export function isTestMode(): boolean {
  return getStripeSecretKey()?.startsWith("sk_test_") ?? false;
}

export function describePaymentsCapability(): {
  configured: boolean;
  testMode: boolean;
  missing: string[];
  problems: string[];
} {
  const missing: string[] = [];
  if (!getStripeSecretKey()) missing.push("STRIPE_SECRET_KEY");
  if (!getWebhookSecret()) missing.push("STRIPE_WEBHOOK_SECRET");

  const problems = [
    describeMisconfiguration("STRIPE_SECRET_KEY", SECRET_KEY_PATTERN, "an sk_/rk_ secret key"),
    describeMisconfiguration("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET_PATTERN, "a whsec_ secret"),
  ].filter((problem): problem is string => problem !== null);

  return { configured: missing.length === 0, testMode: isTestMode(), missing, problems };
}

export class PaymentsUnavailableError extends Error {
  constructor() {
    super("Stripe is not configured");
    this.name = "PaymentsUnavailableError";
  }
}

function getClient(): Stripe {
  const key = getStripeSecretKey();
  if (!key) throw new PaymentsUnavailableError();
  client ??= new Stripe(key, {
    // Bounded so a Stripe incident cannot hold a request open indefinitely.
    timeout: 15_000,
    maxNetworkRetries: 2,
    appInfo: { name: "milkandhenny", url: "https://milkandhenny.com" },
  });
  return client;
}

export type CreateCheckoutInput = {
  eventTitle: string;
  ticketTypeName: string;
  priceMinor: number;
  currency: string;
  quantity: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
  /** Echoed back on the webhook so issuance knows what was bought. */
  metadata: Record<string, string>;
  /** Our own id, used as the idempotency key so a double-submit is one session. */
  reference: string;
};

export type CheckoutSession = {
  id: string;
  url: string;
};

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
  const session = await getClient().checkout.sessions.create(
    {
      mode: "payment",
      customer_email: input.email,
      line_items: [
        {
          quantity: input.quantity,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.priceMinor,
            product_data: {
              name: `${input.eventTitle} — ${input.ticketTypeName}`,
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      // Carried onto the PaymentIntent so a refund initiated from the Stripe
      // dashboard can still be traced back to the order.
      payment_intent_data: { metadata: input.metadata },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    { idempotencyKey: `checkout:${input.reference}` },
  );

  if (!session.url) throw new Error("Stripe returned a session with no redirect URL");
  return { id: session.id, url: session.url };
}

export type RefundResult = { ok: true; refundId: string } | { ok: false; error: string };

/**
 * Refund a payment.
 *
 * Idempotency is keyed on the ticket, so a double-tapped refund button
 * produces one refund rather than two.
 */
export async function refundPayment(input: {
  paymentIntentId: string;
  amountMinor?: number;
  reference: string;
}): Promise<RefundResult> {
  try {
    const refund = await getClient().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        ...(input.amountMinor !== undefined ? { amount: input.amountMinor } : {}),
        reason: "requested_by_customer",
      },
      { idempotencyKey: `refund:${input.reference}` },
    );
    return { ok: true, refundId: refund.id };
  } catch (error) {
    log.error("stripe.refund", "Refund failed", { reference: input.reference }, error);
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Refund failed at the payment provider";
    return { ok: false, error: message };
  }
}

export async function retrieveSession(sessionId: string): Promise<{
  paid: boolean;
  paymentIntentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  email: string | null;
  metadata: Record<string, string>;
} | null> {
  try {
    const session = await getClient().checkout.sessions.retrieve(sessionId);
    return {
      paid: session.payment_status === "paid",
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
      amountMinor: session.amount_total,
      currency: session.currency,
      email: session.customer_details?.email ?? session.customer_email ?? null,
      metadata: (session.metadata ?? {}) as Record<string, string>,
    };
  } catch (error) {
    log.error("stripe.session", "Failed to retrieve session", { sessionId }, error);
    return null;
  }
}

/**
 * Verify a webhook signature against the raw request body.
 *
 * The body must be the exact bytes Stripe sent — parsing and re-serialising
 * changes them and the signature will not match.
 */
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = getWebhookSecret();
  if (!secret) throw new PaymentsUnavailableError();
  return getClient().webhooks.constructEvent(rawBody, signature, secret);
}

export type { Stripe };
