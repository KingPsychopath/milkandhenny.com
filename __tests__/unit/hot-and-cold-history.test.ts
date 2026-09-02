import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOT_AND_COLD_LATEST_JUDGING_VERSION } from "@/features/things/hot-and-cold/hot-and-cold-rules";

const mocks = vi.hoisted(() => ({
  recordPersonGame: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator(next: (value: unknown) => unknown) {
        validate = next;
        return builder;
      },
      handler<T>(handle: (input: { data: never }) => T) {
        return (input?: { data?: unknown }) => handle({ data: validate(input?.data) as never });
      },
    };
    return builder;
  },
}));

vi.mock("@/features/attendee-access/session.server", () => ({
  getAttendeeSession: async () => ({
    personId: "01890f3e-7b1a-7cc2-b5c3-3f8b6a4d2190",
  }),
}));

vi.mock("@/features/person-games/history.server", () => ({
  recordPersonGame: mocks.recordPersonGame,
}));

vi.mock("@/lib/platform/logger.server", () => ({
  log: { warn: mocks.warn },
}));

vi.mock("@/features/things/hot-and-cold/hot-and-cold-room.server", () => ({
  createHotAndColdRoom: async () => ({
    snapshot: {
      roomId: "ROOM",
      gameNumber: 1,
      playerId: "player-1",
      phase: "lobby",
      rounds: 3,
      winnerIds: [],
      players: [{ id: "player-1", name: "Abel", score: 0, turnsUsed: 0 }],
    },
  }),
  joinHotAndColdRoom: vi.fn(),
  readHotAndColdSnapshot: vi.fn(),
  applyHotAndColdAction: vi.fn(),
}));

vi.mock("@/features/things/hot-and-cold/hot-and-cold-scorer.server", () => ({
  HotAndColdInvalidGuessError: class HotAndColdInvalidGuessError extends Error {},
  scoreHotAndColdGuess: async (_target: string, word: string) => {
    if (word === "old!") {
      const { HotAndColdInvalidGuessError } =
        await import("@/features/things/hot-and-cold/hot-and-cold-scorer.server");
      throw new HotAndColdInvalidGuessError();
    }
    return {
      word: "apple",
      rank: 12,
      band: "hot",
      judgingVersion: HOT_AND_COLD_LATEST_JUDGING_VERSION,
    };
  },
}));

vi.mock("@/features/things/hot-and-cold/hot-and-cold-lexicon.server", () => ({
  hotAndColdHint: async () => ({ word: "pear", rank: 20 }),
}));

vi.mock("@/features/things/hot-and-cold/hot-and-cold-words.server", () => ({
  hotAndColdPuzzleNumber: () => 42,
  hotAndColdTargetForPuzzle: () => "orange",
}));

import {
  createHotAndColdRoomFn,
  getDailyHotAndColdHintFn,
  rescoreSavedDailyHotAndColdWordsFn,
  scoreDailyHotAndColdGuessFn,
} from "@/features/things/hot-and-cold/hot-and-cold.functions";

describe("Hot & Cold optional history", () => {
  beforeEach(() => {
    mocks.recordPersonGame.mockReset().mockRejectedValue(new Error("history unavailable"));
    mocks.warn.mockReset();
  });

  it("returns daily scores and hints when history recording fails", async () => {
    await expect(
      scoreDailyHotAndColdGuessFn({
        data: {
          word: "apple",
          puzzle: 42,
          judgingVersion: HOT_AND_COLD_LATEST_JUDGING_VERSION,
        },
      }),
    ).resolves.toMatchObject({ ok: true, puzzle: 42, word: "apple", rank: 12 });
    await expect(
      getDailyHotAndColdHintFn({
        data: {
          puzzle: 42,
          hintIndex: 0,
          usedWords: [],
          judgingVersion: HOT_AND_COLD_LATEST_JUDGING_VERSION,
        },
      }),
    ).resolves.toMatchObject({ puzzle: 42, word: "pear", rank: 20 });
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });

  it("returns a created room when history recording fails", async () => {
    await expect(
      createHotAndColdRoomFn({ data: { hostName: "Abel", rounds: 3 } }),
    ).resolves.toMatchObject({ snapshot: { roomId: "ROOM" } });
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("replays valid saved words without losing the whole run to a retired word", async () => {
    await expect(
      rescoreSavedDailyHotAndColdWordsFn({
        data: {
          puzzle: 42,
          judgingVersion: HOT_AND_COLD_LATEST_JUDGING_VERSION,
          words: ["apple", "old!"],
        },
      }),
    ).resolves.toMatchObject({
      target: "orange",
      words: [
        { ok: true, word: "apple", rank: 12 },
        { ok: false, word: "old!" },
      ],
    });
  });
});
