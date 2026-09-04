import { describe, expect, it } from "vitest";
import { fromZonedDateTimeInput, toZonedDateTimeInput } from "@/lib/shared/zoned-datetime";

describe("explicit timezone editing", () => {
  it.each(["UTC", "Europe/London", "America/New_York", "Asia/Kolkata"])(
    "preserves instants in %s",
    (zone) => {
      for (const iso of ["2026-09-05T18:00:00.000Z", "2026-01-05T18:00:00.000Z"]) {
        expect(fromZonedDateTimeInput(toZonedDateTimeInput(iso, zone), zone)).toBe(iso);
      }
    },
  );
  it("interprets an event wall clock independently of the browser timezone", () => {
    expect(fromZonedDateTimeInput("2026-09-05T19:00", "Europe/London")).toBe(
      "2026-09-05T18:00:00.000Z",
    );
  });
  it("rejects daylight-saving gaps and folds", () => {
    expect(() => fromZonedDateTimeInput("2026-03-29T01:30", "Europe/London")).toThrow(
      "does not exist",
    );
    expect(() => fromZonedDateTimeInput("2026-10-25T01:30", "Europe/London")).toThrow(
      "occurs twice",
    );
    expect(() => fromZonedDateTimeInput("2026-02-30T12:00", "UTC")).toThrow();
  });
});
