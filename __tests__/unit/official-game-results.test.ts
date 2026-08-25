import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/redis-direct.server", () => ({
  getDirectRedisConfig: () => null,
}));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  persistRoomWithOfficialResults,
  publishOfficialResultsAfterCommit,
  sealOfficialGameResult,
  subscribeOfficialResultWake,
} from "@/features/game-results/outbox.server";
import { pairedGameOfficialResult } from "@/features/things/remote/paired-game-room-engine.server";

describe("official game result outbox", () => {
  it("accepts only a paired server result for Heads Up and Spelling Bee", () => {
    const envelope = pairedGameOfficialResult({
      roomId: "ROOM",
      channelId: "gsc_remote",
      snapshot: {
        game: "heads-up",
        phase: "results",
        deckName: "People",
        currentLabel: null,
        nextLabel: null,
        secondsRemaining: 0,
        paused: false,
        score: 4,
        results: [],
        updatedAt: 1,
        roundId: "round-1",
        itemId: null,
        revision: 8,
        connectionEpoch: "epoch-1",
        commandReceipts: [],
      },
    });
    expect(envelope).toMatchObject({
      gameKind: "heads-up",
      resultId: "round:round-1",
      revision: 8,
      players: [{ playerId: "player:ROOM", rawScore: 4 }],
    });
  });

  it("keeps an unbound room on the single state-write path", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    const multi = vi.fn();
    const redis = { set, multi } as unknown as Parameters<
      typeof persistRoomWithOfficialResults
    >[0]["redis"];

    const queued = await persistRoomWithOfficialResults({
      redis,
      stateKey: "things:centre:ROOM:state",
      room: { phase: "finished" },
      ttlSeconds: 60,
      envelopes: [],
    });

    expect(queued).toEqual([]);
    expect(set).toHaveBeenCalledOnce();
    expect(multi).not.toHaveBeenCalled();
  });

  it("commits bound room state and its result in one Redis transaction", async () => {
    const writes: Array<{ key: string; value: unknown }> = [];
    const transactionSet = vi.fn((key: string, value: unknown) => {
      writes.push({ key, value });
      return transaction;
    });
    const exec = vi.fn().mockResolvedValue([]);
    const transaction = { set: transactionSet, exec };
    const redis = { multi: () => transaction } as unknown as Parameters<
      typeof persistRoomWithOfficialResults
    >[0]["redis"];
    const envelope = sealOfficialGameResult({
      channelId: "gsc_test",
      revision: 1,
      committedAt: "2026-08-08T12:00:00.000Z",
      result: {
        gameKind: "centre",
        gameInstanceId: "ROOM",
        resultId: "game:1",
        scope: "game",
        players: [{ playerId: "player-1", outcome: "completed", placement: 1 }],
      },
    });

    const queued = await persistRoomWithOfficialResults({
      redis,
      stateKey: "things:centre:ROOM:state",
      room: { phase: "finished" },
      ttlSeconds: 60,
      envelopes: [envelope],
    });

    expect(exec).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(2);
    expect(writes[0]?.key).toBe("things:centre:ROOM:state");
    expect(writes[1]?.key).toContain("things:official-result-outbox:gsc_test:game:1:1");
    expect(queued).toEqual([{ key: writes[1]?.key, envelope }]);
  });

  it("publishes advisory wakes to explicit subscribers without owning a scoring callback", async () => {
    const envelope = sealOfficialGameResult({
      channelId: "gsc_test",
      revision: 1,
      result: {
        gameKind: "centre",
        gameInstanceId: "ROOM",
        resultId: "game:1",
        scope: "game",
        players: [],
      },
    });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeOfficialResultWake(first);
    const stopSecond = subscribeOfficialResultWake(second);

    publishOfficialResultsAfterCommit([{ key: "memory:1", envelope }]);
    await vi.waitFor(() => {
      expect(first).toHaveBeenCalledWith([envelope]);
      expect(second).toHaveBeenCalledWith([envelope]);
    });

    await stopFirst();
    await stopSecond();
  });
});
