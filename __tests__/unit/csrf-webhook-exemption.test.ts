import { describe, it, expect } from "vitest";

/**
 * Regression test for the Stripe webhook origin-check exemption.
 *
 * The CSRF middleware runs with `allowRequestsWithoutOriginCheck: false`, so
 * any POST arriving without a same-origin `Origin` or `Referer` is rejected
 * with 403. Stripe's servers send neither — every genuine webhook delivery
 * was being rejected, which meant paid tickets were never issued.
 *
 * The webhook authenticates itself with an HMAC over the raw body, which is
 * strictly stronger than an origin header. This test exists so nobody
 * "tidies away" the exemption and silently breaks paid ticketing again.
 */

import { isOriginCheckExempt } from "@/src/start";

function post(path: string): Request {
  return new Request(`https://milkandhenny.com${path}`, { method: "POST" });
}

describe("origin-check exemption", () => {
  it("exempts the Stripe webhook, which has no Origin header to check", () => {
    expect(isOriginCheckExempt(post("/api/stripe/webhook"))).toBe(true);
  });

  it("does not exempt anything else under /api", () => {
    for (const path of [
      "/api/guests",
      "/api/admin/events",
      "/api/tickets/redeem",
      "/api/stripe",
      "/api/stripe/webhook/extra",
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
