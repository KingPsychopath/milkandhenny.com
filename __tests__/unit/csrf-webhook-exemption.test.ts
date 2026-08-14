import { describe, it, expect } from "vitest";

/**
 * Regression tests for authenticated server-to-server origin-check exemptions.
 *
 * The CSRF middleware runs with `allowRequestsWithoutOriginCheck: false`, so
 * any POST arriving without a same-origin `Origin` or `Referer` is rejected
 * with 403. Stripe's servers send neither — every genuine webhook delivery
 * was being rejected, which meant paid tickets were never issued.
 *
 * Stripe authenticates with an HMAC over the raw body. The Cloudflare email
 * relay authenticates with a shared bearer secret. Both checks are stronger
 * than an origin header.
 */

import { isOriginCheckExempt } from "@/src/start";

function post(path: string): Request {
  return new Request(`https://milkandhenny.com${path}`, { method: "POST" });
}

describe("origin-check exemption", () => {
  it("exempts the Stripe webhook, which has no Origin header to check", () => {
    expect(isOriginCheckExempt(post("/api/stripe/webhook"))).toBe(true);
  });

  it("exempts the Cloudflare email relay, which has no Origin header to check", () => {
    expect(isOriginCheckExempt(post("/api/email/events/cloudflare"))).toBe(true);
  });

  it("does not exempt anything else under /api", () => {
    for (const path of [
      "/api/guests",
      "/api/admin/events",
      "/api/tickets/redeem",
      "/api/stripe",
      "/api/stripe/webhook/extra",
      "/api/email/events/cloudflare/extra",
    ]) {
      expect(isOriginCheckExempt(post(path))).toBe(false);
    }
  });

  it("is not fooled by a query string or a different host", () => {
    expect(isOriginCheckExempt(post("/api/stripe/webhook?x=1"))).toBe(true);
    expect(
      isOriginCheckExempt(
        new Request("https://evil.example/api/stripe/webhook", { method: "POST" }),
      ),
    ).toBe(true);
  });
});
