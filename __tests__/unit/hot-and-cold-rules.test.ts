import { describe, expect, it } from "vitest";

import {
  heatBand,
  heatStreaks,
  hotAndColdJudgingVersionForPuzzle,
  orderGuesses,
  roundWinnerIds,
} from "@/features/things/hot-and-cold/hot-and-cold-rules";
import {
  HOT_AND_COLD_TARGETS,
  dailyHotAndColdTarget,
  hotAndColdPuzzleNumber,
  hotAndColdTargetForPuzzle,
  previousHotAndColdPuzzles,
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
      hotAndColdTargetForPuzzle(offset + 1),
    );

    expect(new Set(targets).size).toBe(HOT_AND_COLD_TARGETS.length);
    expect([...targets].sort()).toEqual([...HOT_AND_COLD_TARGETS].sort());
  });

  it("starts at puzzle one and changes at midnight in the UK", () => {
    expect(hotAndColdPuzzleNumber(new Date("2026-08-25T22:59:59Z"))).toBe(1);
    expect(hotAndColdPuzzleNumber(new Date("2026-08-25T23:00:00Z"))).toBe(2);
    expect(hotAndColdPuzzleNumber(new Date("2026-08-27T12:00:00Z"))).toBe(3);
    expect(dailyHotAndColdTarget(new Date("2026-08-25T12:00:00Z"))).toBe(
      hotAndColdTargetForPuzzle(1),
    );
    expect(hotAndColdTargetForPuzzle(1)).toBe("chimney");
    expect(hotAndColdTargetForPuzzle(2)).toBe("diary");
    expect(hotAndColdTargetForPuzzle(5)).toBe("scarf");
    expect(previousHotAndColdPuzzles(new Date("2026-08-27T12:00:00Z"))).toEqual([
      { puzzle: 2, date: "2026-08-26" },
      { puzzle: 1, date: "2026-08-25" },
    ]);
  });

  it("keeps played dailies on their original judging revision", () => {
    expect(hotAndColdJudgingVersionForPuzzle(1)).toBe("1.0.0");
    expect(hotAndColdJudgingVersionForPuzzle(5)).toBe("1.0.0");
    expect(hotAndColdJudgingVersionForPuzzle(6)).toBe("2.0.0");
  });
});
