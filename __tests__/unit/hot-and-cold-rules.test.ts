import { describe, expect, it } from "vitest";

import {
  heatBand,
  orderGuesses,
  roundWinnerIds,
} from "@/features/things/hot-and-cold/hot-and-cold-rules";
import {
  HOT_AND_COLD_TARGETS,
  dailyHotAndColdTarget,
} from "@/features/things/hot-and-cold/hot-and-cold-words.server";

describe("Hot and Cold rules", () => {
  it("keeps zero exact and makes lower ranks hotter", () => {
    expect(heatBand(0)).toBe("found");
    expect(heatBand(49)).toBe("burning");
    expect(heatBand(28_000)).toBe("frozen");
  });

  it("orders the shared ledger by rank and preserves arrival order for ties", () => {
    expect(
      orderGuesses([
        { rank: 500, sequence: 1, word: "first" },
        { rank: 12, sequence: 3, word: "hot" },
        { rank: 500, sequence: 2, word: "second" },
      ]).map(({ word }) => word),
    ).toEqual(["hot", "first", "second"]);
  });

  it("allows tied closest players to share a round win", () => {
    expect(
      roundWinnerIds(
        [
          { playerId: "ada", rank: 42 },
          { playerId: "bea", rank: 42 },
          { playerId: "cy", rank: 90 },
        ],
        ["ada", "bea", "cy"],
      ),
    ).toEqual(["ada", "bea"]);
  });

  it("does not repeat a daily target within one complete deck cycle", () => {
    expect(new Set(HOT_AND_COLD_TARGETS).size).toBe(HOT_AND_COLD_TARGETS.length);
    const targets = Array.from({ length: HOT_AND_COLD_TARGETS.length }, (_, offset) =>
      dailyHotAndColdTarget(new Date(Date.UTC(2025, 7, 15 + offset))),
    );

    expect(new Set(targets).size).toBe(HOT_AND_COLD_TARGETS.length);
  });
});
