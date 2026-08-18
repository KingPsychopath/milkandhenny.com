import { describe, it, expect } from "vitest";

/**
 * The origin every outbound link is built from.
 *
 * Behind a TLS-terminating proxy the request URL is plain `http://`, so
 * trusting it put `http://` links into ticket emails, calendar files and
 * Stripe return URLs. These cases pin the rule that replaced that.
 */

import { BASE_URL, getBaseUrlForRequest } from "@/lib/shared/config";

describe("share link origin", () => {
  it("keeps the request origin in local development", () => {
    expect(getBaseUrlForRequest({ url: "http://localhost:5299/api/events/x/ics" })).toBe(
      "http://localhost:5299",
    );
    expect(getBaseUrlForRequest({ url: "http://127.0.0.1:3000/api/health" })).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("uses the canonical origin for a proxied production request", () => {
    expect(getBaseUrlForRequest({ url: "http://milkandhenny.com/api/events/x/ics" })).toBe(
      BASE_URL,
    );
    expect(BASE_URL.startsWith("https://")).toBe(true);
  });

  it("never trusts an internal hostname the proxy happens to use", () => {
    expect(getBaseUrlForRequest({ url: "http://web.railway.internal:8080/api/health" })).toBe(
      BASE_URL,
    );
  });

  it("falls back rather than throwing on an unparseable url", () => {
    expect(getBaseUrlForRequest({ url: "not-a-url" })).toBe(BASE_URL);
  });
});
