import { describe, expect, it } from "vitest";

import {
  heatBand,
  heatStreaks,
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

  it("counts consecutive warm guesses while hints and the answer stay neutral", () => {
    expect(
      heatStreaks([
        { rank: 900, sequence: 2 },
        { rank: 6_000, sequence: 1 },
        { rank: 300, sequence: 3, hint: true },
        { rank: 80, sequence: 4 },
        { rank: 0, sequence: 5 },
        { rank: 8_000, sequence: 6 },
        { rank: 4_000, sequence: 7 },
      ]),
    ).toEqual({ current: 1, longest: 2 });
  });

  it("does not repeat a daily target within one complete deck cycle", () => {
    expect(new Set(HOT_AND_COLD_TARGETS).size).toBe(HOT_AND_COLD_TARGETS.length);
    const targets = Array.from({ length: HOT_AND_COLD_TARGETS.length }, (_, offset) =>
      dailyHotAndColdTarget(new Date(Date.UTC(2025, 7, 15 + offset))),
    );

    expect(new Set(targets).size).toBe(HOT_AND_COLD_TARGETS.length);
  });
});
