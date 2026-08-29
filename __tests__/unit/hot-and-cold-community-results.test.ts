import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/postgres.server", () => ({
  isDatabaseConfigured: () => false,
  query: vi.fn(),
}));

import {
  hotAndColdCommunityStats,
  hotAndColdResultCommunityStats,
  recordHotAndColdDailyResult,
} from "@/features/things/hot-and-cold/hot-and-cold-daily-results.server";
import { HOT_AND_COLD_JUDGING_VERSION } from "@/features/things/hot-and-cold/hot-and-cold-rules";
import { hotAndColdTargetForPuzzle } from "@/features/things/hot-and-cold/hot-and-cold-words.server";

describe("Hot & Cold community results", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("keeps small samples private and records each run once", async () => {
    const runIds = [
      "0198e9d8-53d7-7db1-8da4-c0f557db73a1",
      "0198e9d8-53d7-7db2-8da4-c0f557db73a2",
      "0198e9d8-53d7-7db3-8da4-c0f557db73a3",
      "0198e9d8-53d7-7db4-8da4-c0f557db73a4",
      "0198e9d8-53d7-7db5-8da4-c0f557db73a5",
    ];
    for (const [index, runId] of runIds.slice(0, 4).entries()) {
      await recordHotAndColdDailyResult(
        {
          runId,
          puzzle: 901,
          target: hotAndColdTargetForPuzzle(901),
          judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
          outcome: "found",
          guesses: index + 2,
          hints: index % 2,
          bestRank: 0,
          distribution: { frost: index + 1, cool: 0, warm: 0, hot: 0 },
        },
        null,
      );
    }
    expect((await hotAndColdCommunityStats([901])).get(901)).toEqual({
      runs: 4,
      visible: false,
    });
    await recordHotAndColdDailyResult(
      {
        runId: runIds[4],
        puzzle: 901,
        target: hotAndColdTargetForPuzzle(901),
        judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
        outcome: "revealed",
        guesses: 6,
        hints: 0,
        bestRank: 12,
        distribution: { frost: 5, cool: 0, warm: 0, hot: 0 },
      },
      null,
    );
    await recordHotAndColdDailyResult(
      {
        runId: runIds[0],
        puzzle: 901,
        target: hotAndColdTargetForPuzzle(901),
        judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
        outcome: "revealed",
        guesses: 100,
        hints: 3,
        bestRank: 900,
        distribution: { frost: 100, cool: 0, warm: 0, hot: 0 },
      },
      null,
    );

    const stats = await hotAndColdCommunityStats([901]);
    expect(stats.get(901)).toMatchObject({
      runs: 5,
      visible: true,
      solveRate: 0.8,
      medianGuesses: 3.5,
    });
  });

  it("keeps an unplayed puzzle private until five real runs exist", async () => {
    expect((await hotAndColdCommunityStats([1])).get(1)).toBeUndefined();
    for (let index = 1; index <= 5; index += 1) {
      await recordHotAndColdDailyResult(
        {
          runId: `0198e9d8-53d7-7dc${index}-8da4-c0f557db73b${index}`,
          puzzle: 1,
          target: hotAndColdTargetForPuzzle(1),
          judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
          outcome: "found",
          guesses: 3,
          hints: 0,
          bestRank: 0,
          distribution: { frost: 1, cool: 0, warm: 0, hot: 1 },
        },
        null,
      );
    }
    expect((await hotAndColdCommunityStats([1])).get(1)).toMatchObject({
      runs: 5,
      visible: true,
      medianGuesses: 3,
    });
    expect(
      await hotAndColdResultCommunityStats(1, "0198e9d8-53d7-7dc1-8da4-c0f557db73b1"),
    ).toMatchObject({
      standing: {
        rank: 1,
        runs: 5,
        tied: true,
        topPercent: 20,
        hints: 0,
        medianGuesses: 3,
      },
    });
  });

  it("keeps the same browser run independently in each judging revision", async () => {
    const repeatedRun = "0198e9d8-53d7-7de1-8da4-c0f557db73c1";
    const result = {
      puzzle: 902,
      target: hotAndColdTargetForPuzzle(902),
      outcome: "found" as const,
      guesses: 3,
      hints: 0,
      bestRank: 0,
      distribution: { frost: 1, cool: 0, warm: 0, hot: 1 },
    };
    await recordHotAndColdDailyResult(
      { ...result, runId: repeatedRun, judgingVersion: "0.9.0" },
      null,
    );
    for (let index = 1; index <= 5; index += 1) {
      await recordHotAndColdDailyResult(
        {
          ...result,
          runId: index === 1 ? repeatedRun : `0198e9d8-53d7-7de${index}-8da4-c0f557db73c${index}`,
          judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
        },
        null,
      );
    }

    expect((await hotAndColdCommunityStats([902])).get(902)).toMatchObject({
      runs: 5,
      visible: true,
    });
  });
});
