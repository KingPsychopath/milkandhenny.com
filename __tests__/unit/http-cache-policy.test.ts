import { describe, expect, it } from "vitest";

import { ATTENDEE_SESSION_COOKIE_NAME } from "@/features/event-scoring/session-cookie";
import {
  PUBLIC_DISCOVERY_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";
import { applyCachePolicy } from "@/src/start";

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

  it("never shares a response personalized by the attendee session", () => {
    const request = new Request("https://milkandhenny.com/pics", {
      headers: { Cookie: `${ATTENDEE_SESSION_COOKIE_NAME}=session-id` },
    });
    const result = response({ "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL });

    applyCachePolicy("/pics", request, result);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("CDN-Cache-Control")).toBe("no-store");
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
});
