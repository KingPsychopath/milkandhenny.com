import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/features/attendee-access/types";

describe("attendee access boundaries", () => {
  it("accepts only local return paths", () => {
    expect(safeReturnTo("/ticket/abc?from=my")).toBe("/ticket/abc?from=my");
    expect(safeReturnTo("https://evil.example/ticket")).toBe("/my");
    expect(safeReturnTo("//evil.example/ticket")).toBe("/my");
    expect(safeReturnTo(undefined)).toBe("/my");
  });
});
