import { describe, expect, it } from "vitest";

import { attendeeSignInHref, safeReturnTo } from "@/features/attendee-access/types";

describe("attendee access boundaries", () => {
  it("accepts only local return paths", () => {
    expect(safeReturnTo("/ticket/abc?from=my")).toBe("/ticket/abc?from=my");
    expect(safeReturnTo("https://evil.example/ticket")).toBe("/my");
    expect(safeReturnTo("//evil.example/ticket")).toBe("/my");
    expect(safeReturnTo("/\\evil.example/ticket")).toBe("/my");
    expect(safeReturnTo("/ticket/abc\nnext")).toBe("/my");
    expect(safeReturnTo(undefined)).toBe("/my");
  });

  it("builds a local sign-in callback", () => {
    expect(attendeeSignInHref("/events/summer?tab=scores#mine")).toBe(
      "/access?returnTo=%2Fevents%2Fsummer%3Ftab%3Dscores%23mine",
    );
  });
});
