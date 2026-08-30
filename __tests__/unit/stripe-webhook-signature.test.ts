import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { constructWebhookEvent, isPaymentsConfigured } from "@/lib/platform/stripe.server";

const WEBHOOK_SECRET = "whsec_testwebhooksignature";

describe("Stripe webhook signature verification", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_checkoutaudit");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the signed raw body and rejects changed bytes", () => {
    const rawBody = JSON.stringify({
      id: "evt_checkout_completed",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_checkout_completed" } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: WEBHOOK_SECRET,
    });

    expect(isPaymentsConfigured()).toBe(true);
    expect(constructWebhookEvent(rawBody, signature).type).toBe("checkout.session.completed");
    expect(() => constructWebhookEvent(`${rawBody} `, signature)).toThrow();
  });
});
