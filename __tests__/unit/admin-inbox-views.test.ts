import { describe, expect, it } from "vitest";

import { parseSavedInboxViews } from "@/features/admin/ui/admin-inbox-views";

const validView = {
  name: "urgent event work",
  status: "new",
  severity: "critical",
  category: "event",
  event: "summer-party",
};

describe("saved admin inbox views", () => {
  it("restores only complete, named views", () => {
    expect(
      parseSavedInboxViews(
        JSON.stringify([validView, null, { ...validView, name: "" }, { name: "partial" }]),
      ),
    ).toEqual([validView]);
  });

  it("fails safely for corrupt or incompatible browser storage", () => {
    expect(parseSavedInboxViews("not-json")).toEqual([]);
    expect(parseSavedInboxViews(JSON.stringify({ view: validView }))).toEqual([]);
    expect(parseSavedInboxViews(null)).toEqual([]);
  });

  it("caps restored views to keep local state bounded", () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...validView,
      name: `view ${index}`,
    }));
    const restored = parseSavedInboxViews(JSON.stringify(many));
    expect(restored).toHaveLength(20);
    expect(restored[0]?.name).toBe("view 5");
  });
});
