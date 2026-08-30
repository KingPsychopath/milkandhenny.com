import { describe, expect, it } from "vitest";

import {
  applyCachePolicy,
  applyResponsePolicy,
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
} from "@/lib/http/response-policy.server";
import {
  PUBLIC_DISCOVERY_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";

function response(headers?: HeadersInit) {
  return new Response("body", { headers });
}

describe("HTTP cache policy", () => {
  it("requires unclassified dynamic responses to revalidate", () => {
    const result = response({ "Content-Type": "text/html; charset=utf-8" });

    applyCachePolicy("/pics", new Request("https://milkandhenny.com/pics"), result);

    expect(result.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("preserves an explicit public discovery cache policy", () => {
    const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

    applyCachePolicy("/feed.xml", new Request("https://milkandhenny.com/feed.xml"), result);

    expect(result.headers.get("Cache-Control")).toBe(PUBLIC_DISCOVERY_CACHE_CONTROL);
  });

  it("keeps versioned public media immutable", () => {
    const result = response();

    applyCachePolicy(
      "/og/pics.png",
      new Request("https://milkandhenny.com/og/pics.png?v=1"),
      result,
    );

    expect(result.headers.get("Cache-Control")).toBe(VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL);
  });

  it("overrides route headers for private paths", () => {
    const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

    applyCachePolicy("/my", new Request("https://milkandhenny.com/my"), result);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
  });

  it("never stores a ticket-holder response containing a private event location", () => {
    const request = new Request("https://milkandhenny.com/pics", {
      headers: { Cookie: "mah-ticket-holder=event.signature" },
    });
    const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

    applyCachePolicy("/pics", request, result);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
  });

  it("treats every cookie or authorisation-bearing dynamic response as private", () => {
    for (const headers of [
      new Headers({ Cookie: "preference=value" }),
      new Headers({ Authorization: "Bearer secret" }),
    ]) {
      const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

      applyCachePolicy(
        "/events/apartment-life",
        new Request("https://milkandhenny.com/events/apartment-life", { headers }),
        result,
      );

      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
      expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
    }
  });

  it("does not let a sensitive query enter a public cache", () => {
    const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

    applyCachePolicy(
      "/words/private-note",
      new Request("https://milkandhenny.com/words/private-note?share=secret"),
      result,
    );

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps known static assets cacheable when a browser also sends cookies", () => {
    const result = response();

    applyCachePolicy(
      "/_build/app.abc123.js",
      new Request("https://milkandhenny.com/_build/app.abc123.js", {
        headers: { Cookie: "mah-ticket-holder=event.signature" },
      }),
      result,
    );

    expect(result.headers.get("Cache-Control")).toBe(VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL);
  });

  it("never shares a response that sets a cookie", () => {
    const result = response({
      "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL,
      "Set-Cookie": "session=value; Path=/; HttpOnly",
    });

    applyCachePolicy("/", new Request("https://milkandhenny.com/"), result);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
  });

  it("marks errors private and keeps them out of search indexes", () => {
    const result = new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL },
    });
    const request = new Request("https://milkandhenny.com/missing");

    applyResponsePolicy("/missing", request, result);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
  });

  it("applies the shared security policy at the response boundary", () => {
    const result = response({ Server: "provider", "X-Powered-By": "framework" });

    applyResponsePolicy("/", new Request("https://milkandhenny.com/"), result);

    expect(result.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(result.headers.get("Content-Security-Policy")).toContain("frame-src 'none'");
    expect(result.headers.get("Content-Security-Policy")).not.toContain("fonts.googleapis.com");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.get("Server")).toBeNull();
    expect(result.headers.get("X-Powered-By")).toBeNull();
  });

  it("opens the external font origins only on the isolated font test page", () => {
    expect(buildContentSecurityPolicy("/font-test")).toContain("fonts.googleapis.com");
    expect(buildContentSecurityPolicy("/font-test")).toContain("fonts.gstatic.com");
    expect(buildContentSecurityPolicy("/privacy")).not.toContain("fonts.googleapis.com");
  });
});
