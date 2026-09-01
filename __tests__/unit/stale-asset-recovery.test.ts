import { describe, expect, it } from "vitest";

import { canReloadStaleAssets, isStaleAssetError } from "@/lib/client/stale-asset-recovery";

describe("stale asset recovery", () => {
  it("should recognise browser and bundler errors caused by a replaced release", () => {
    expect(
      isStaleAssetError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://milkandhenny.com/assets/PitchesPanel-old.js",
        ),
      ),
    ).toBe(true);
    expect(isStaleAssetError(new Error("Loading chunk 42 failed"))).toBe(true);
    expect(isStaleAssetError(new Error("Pitch deck not found"))).toBe(false);
  });

  it("should permit one automatic reload per cooldown window", () => {
    expect(canReloadStaleAssets(null, 100_000)).toBe(true);
    expect(canReloadStaleAssets("90000", 100_000)).toBe(false);
    expect(canReloadStaleAssets("40000", 100_000)).toBe(true);
    expect(canReloadStaleAssets("not-a-time", 100_000)).toBe(true);
  });
});
