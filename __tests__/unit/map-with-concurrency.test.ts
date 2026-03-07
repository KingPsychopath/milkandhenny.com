import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order while limiting active work", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBe(2);
  });

  it("treats invalid concurrency values as 1", async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (value) => value + 1);
    expect(results).toEqual([2, 3]);
  });
});
