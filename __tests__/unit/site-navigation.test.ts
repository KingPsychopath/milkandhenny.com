import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARTY_PATH,
  defaultFooterPartyPath,
  parseFooterPartyPath,
} from "@/features/site/site-navigation";

const now = Date.parse("2026-08-24T12:00:00.000Z");

describe("footer party navigation", () => {
  it("rejects external and malformed destinations", () => {
    expect(parseFooterPartyPath("https://example.com").ok).toBe(false);
    expect(parseFooterPartyPath("//example.com").ok).toBe(false);
    expect(parseFooterPartyPath("/events/summer-night")).toEqual({
      ok: true,
      path: "/events/summer-night",
    });
    expect(parseFooterPartyPath("")).toEqual({ ok: true, path: null });
  });

  it("uses the latest upcoming active event", () => {
    expect(
      defaultFooterPartyPath(
        [
          {
            slug: "cancelled",
            status: "cancelled",
            startsAt: "2026-09-30T20:00:00.000Z",
            endsAt: undefined,
          },
          {
            slug: "earlier",
            status: "published",
            startsAt: "2026-09-01T20:00:00.000Z",
            endsAt: undefined,
          },
          {
            slug: "latest",
            status: "sold-out",
            startsAt: "2026-10-01T20:00:00.000Z",
            endsAt: undefined,
          },
        ],
        now,
      ),
    ).toBe("/events/latest");
  });

  it("falls back to the existing party page when no event is active", () => {
    expect(
      defaultFooterPartyPath(
        [
          {
            slug: "draft",
            status: "draft",
            startsAt: "2026-10-01T20:00:00.000Z",
            endsAt: undefined,
          },
        ],
        now,
      ),
    ).toBe(DEFAULT_PARTY_PATH);
  });
});
