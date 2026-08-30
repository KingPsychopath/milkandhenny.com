import { afterEach, describe, expect, it, vi } from "vitest";

const deliveredOfficialResults = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/game-results/outbox.server", () => ({
  publishOfficialResultsAfterCommit: vi.fn((queued: Array<{ envelope: Record<string, unknown> }>) =>
    deliveredOfficialResults.push(...queued.map(({ envelope }) => envelope)),
  ),
  persistRoomWithOfficialResults: vi.fn(),
  sealOfficialGameResult: vi.fn(
    (input: { channelId: string; revision: number; result: Record<string, unknown> }) => ({
      ...input.result,
      schemaVersion: 1,
      channelId: input.channelId,
      revision: input.revision,
      operation: "record",
      committedAt: "2026-08-30T12:00:00.000Z",
      payloadHash: "b".repeat(64),
    }),
  ),
}));

import {
  closePairedGameRoom,
  createPairedGameRoom,
  disconnectPairedGameJudge,
  readPairedGameJudge,
  readPairedGamePlayerSetup,
  sendPairedGameJudgeCommand,
  syncPairedGamePlayer,
} from "../../features/things/remote/paired-game-room.server";
import { remoteGameSetup } from "../../features/things/remote/paired-game-room.functions";
import type {
  RemoteHeadsUpSetup,
  RemoteSpellingSetup,
  RemoteSyncedSnapshot,
} from "../../features/things/remote/types";

const headsUpSetup: RemoteHeadsUpSetup = {
  game: "heads-up",
  deck: { name: "All sorts", cards: ["Bubble wrap", "Chess", "Big Ben"] },
  orientation: "auto",
};

const spellingSetup: RemoteSpellingSetup = {
  game: "spelling-bee",
  deck: {
    name: "Warm-up words",
    words: [
      { id: "one", word: "beautiful" },
      { id: "two", word: "calendar" },
      { id: "three", word: "definitely" },
    ],
  },
  timerSeconds: 30,
  autoSpeak: true,
};
const judgeLease = { judgeEpoch: "judge-test-epoch", takeover: false } as const;

const snapshot: RemoteSyncedSnapshot = {
  game: "heads-up",
  phase: "playing",
  deckName: "All sorts",
  currentLabel: "Bubble wrap",
  nextLabel: "Chess",
  secondsRemaining: 42,
  paused: false,
  score: 0,
  results: [],
  roundId: "round-1",
  itemId: "round-1:card-1",
  revision: 1,
  connectionEpoch: "connection-1",
  commandReceipts: [],
  updatedAt: Date.now(),
};

afterEach(() => {
  deliveredOfficialResults.length = 0;
  vi.useRealTimers();
});

describe("remote game rooms", () => {
  it("lets a player-created room invite a judge and delivers acknowledged commands once", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    const initial = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    expect(initial.ok).toBe(true);

    const judge = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      ...judgeLease,
    });
    expect(judge.snapshot?.currentLabel).toBe("Bubble wrap");
    expect(judge.playerConnected).toBe(true);

    await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: {
        id: "decision-1",
        type: "correct",
        createdAt: Date.now(),
        roundId: snapshot.roundId!,
        itemId: snapshot.itemId!,
      },
    });
    const received = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    expect(received.commands).toHaveLength(1);

    const acknowledged = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: received.commands[0].sequence,
    });
    expect(acknowledged.commands).toHaveLength(0);
  });

  it("keeps HTTPS fallback presence alive between safety polls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T10:00:00Z"));
    try {
      const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
      await syncPairedGamePlayer({
        roomId: room.roomId,
        playerToken: room.playerToken,
        snapshot,
        lastCommandSequence: 0,
      });

      vi.advanceTimersByTime(12_500);
      const judge = await readPairedGameJudge({
        roomId: room.roomId,
        judgeToken: room.judgeToken,
        ...judgeLease,
      });
      expect(judge.playerConnected).toBe(true);

      vi.advanceTimersByTime(12_500);
      const player = await syncPairedGamePlayer({
        roomId: room.roomId,
        playerToken: room.playerToken,
        snapshot,
        lastCommandSequence: 0,
      });
      expect(player.judgeConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the full lobby lifetime until renewal is actually needed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:00:00Z"));
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    const initialJudgeRead = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      ...judgeLease,
    });
    expect(initialJudgeRead.expiresAt).toBe(room.expiresAt);

    vi.advanceTimersByTime(26 * 60_000);
    const renewed = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      ...judgeLease,
    });
    expect(renewed.expiresAt).toBeGreaterThan(room.expiresAt);
  });

  it("publishes event results once per authoritative revision", async () => {
    const room = await createPairedGameRoom({
      creatorRole: "player",
      setup: headsUpSetup,
      officialResultChannelId: "gsc_remote_event",
    });
    const completed: RemoteSyncedSnapshot = {
      ...snapshot,
      phase: "results",
      currentLabel: null,
      nextLabel: null,
      secondsRemaining: null,
      itemId: null,
      score: 1,
      revision: 2,
    };
    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: completed,
      lastCommandSequence: 0,
    });
    expect(deliveredOfficialResults).toHaveLength(1);
    expect(deliveredOfficialResults[0]).toMatchObject({
      channelId: "gsc_remote_event",
      gameKind: "heads-up",
      gameInstanceId: room.roomId,
      resultId: "round:round-1",
      revision: 2,
      scope: "round",
      players: [{ playerId: `player:${room.roomId}`, rawScore: 1, won: true }],
    });

    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: completed,
      lastCommandSequence: 0,
    });
    expect(deliveredOfficialResults).toHaveLength(1);

    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: { ...completed, score: 2, revision: 3 },
      lastCommandSequence: 0,
    });
    expect(deliveredOfficialResults).toHaveLength(2);
    expect(deliveredOfficialResults[1]).toMatchObject({
      resultId: "round:round-1",
      revision: 3,
      players: [{ rawScore: 2 }],
    });
  });

  it("lets a judge-created room transfer setup to the player without transferring device preferences", async () => {
    const room = await createPairedGameRoom({ creatorRole: "judge", setup: spellingSetup });
    const player = await readPairedGamePlayerSetup({
      roomId: room.roomId,
      playerToken: room.playerToken,
    });

    expect(player.ok).toBe(true);
    expect(player.setup).toEqual(spellingSetup);
    expect(player.judgeConnected).toBe(true);
    expect(player.setup).not.toHaveProperty("soundEnabled");
    expect(player.setup).not.toHaveProperty("microphonePermission");
  });

  it("keeps role credentials separate and only lets the room creator close from the judge role", async () => {
    const playerCreated = await createPairedGameRoom({
      creatorRole: "player",
      setup: headsUpSetup,
    });
    expect(
      (
        await readPairedGamePlayerSetup({
          roomId: playerCreated.roomId,
          playerToken: playerCreated.judgeToken,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await readPairedGameJudge({
          roomId: playerCreated.roomId,
          judgeToken: playerCreated.playerToken,
          ...judgeLease,
        })
      ).ok,
    ).toBe(false);
    expect(
      await closePairedGameRoom(playerCreated.roomId, "judge", playerCreated.judgeToken),
    ).toEqual({ ok: true, closed: false });
    expect(
      (await closePairedGameRoom(playerCreated.roomId, "player", playerCreated.playerToken)).ok,
    ).toBe(true);
    expect(
      (await closePairedGameRoom(playerCreated.roomId, "player", playerCreated.playerToken)).ok,
    ).toBe(true);

    const judgeCreated = await createPairedGameRoom({ creatorRole: "judge", setup: spellingSetup });
    expect(
      (await closePairedGameRoom(judgeCreated.roomId, "judge", judgeCreated.judgeToken)).ok,
    ).toBe(true);
  });

  it("rejects oversized setup payloads at the server boundary", () => {
    expect(() =>
      remoteGameSetup({
        game: "heads-up",
        deck: { name: "Too large", cards: Array.from({ length: 201 }, () => "card") },
      }),
    ).toThrow("Invalid deck");
    expect(() =>
      remoteGameSetup({ game: "spelling-bee", deck: { name: "Too small", words: [] } }),
    ).toThrow("Invalid deck");
  });

  it("rejects stale and future-dated judge commands", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    const target = { roundId: "round-1", itemId: "round-1:card-1" };
    const stale = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: { id: "stale", type: "correct", createdAt: Date.now() - 20_000, ...target },
    });
    const future = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: { id: "future", type: "correct", createdAt: Date.now() + 20_000, ...target },
    });
    expect(stale.ok).toBe(false);
    expect(future.ok).toBe(false);
  });

  it("fences duplicate player tabs, preserves newer snapshots, and rejects stale item targets", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    const newer = { ...snapshot, currentLabel: "Chess", itemId: "round-1:card-2", revision: 2 };
    expect(
      (
        await syncPairedGamePlayer({
          roomId: room.roomId,
          playerToken: room.playerToken,
          snapshot: newer,
          lastCommandSequence: 0,
        })
      ).ok,
    ).toBe(true);

    const older = { ...snapshot, revision: 1 };
    expect(
      (
        await syncPairedGamePlayer({
          roomId: room.roomId,
          playerToken: room.playerToken,
          snapshot: older,
          lastCommandSequence: 0,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await readPairedGameJudge({
          roomId: room.roomId,
          judgeToken: room.judgeToken,
          ...judgeLease,
        })
      ).snapshot?.currentLabel,
    ).toBe("Chess");

    const duplicateTab = { ...newer, connectionEpoch: "connection-2", revision: 3 };
    const fenced = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: duplicateTab,
      lastCommandSequence: 0,
    });
    expect(fenced).toMatchObject({ ok: false, error: "Game is active on another phone" });

    const staleTarget = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: {
        id: "late-decision",
        type: "correct",
        createdAt: Date.now(),
        roundId: "round-1",
        itemId: "round-1:card-1",
      },
    });
    expect(staleTarget).toMatchObject({ ok: false, error: "Card changed" });
  });

  it("keeps the room open and lets the judge request another completed round", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    await readPairedGameJudge({ roomId: room.roomId, judgeToken: room.judgeToken, ...judgeLease });
    const earlyReplay = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: {
        id: "replay-early",
        type: "play_again",
        createdAt: Date.now(),
        roundId: snapshot.roundId!,
        itemId: snapshot.itemId!,
      },
    });
    expect(earlyReplay).toMatchObject({ ok: false, error: "Round is not complete" });

    const completed = {
      ...snapshot,
      phase: "results" as const,
      currentLabel: null,
      nextLabel: null,
      secondsRemaining: null,
      itemId: null,
      results: [{ id: "result-1", label: "Bubble wrap", decision: "correct" as const }],
      revision: 2,
    };
    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: completed,
      lastCommandSequence: 0,
    });

    const replay = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: {
        id: "replay-1",
        type: "play_again",
        createdAt: Date.now(),
        roundId: completed.roundId!,
        itemId: `results:${completed.roundId}`,
      },
    });
    expect(replay.ok).toBe(true);

    const received = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot: completed,
      lastCommandSequence: 0,
    });
    expect(received.commands).toMatchObject([{ type: "play_again" }]);
  });

  it("gives one judge control, supports explicit takeover, and rejects decisions received after the deadline", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: spellingSetup });
    const expiredSnapshot: RemoteSyncedSnapshot = {
      ...snapshot,
      game: "spelling-bee",
      decisionClosesAt: Date.now() - 1,
      connectionEpoch: "deadline-player",
    };
    expect(
      (
        await syncPairedGamePlayer({
          roomId: room.roomId,
          playerToken: room.playerToken,
          snapshot: expiredSnapshot,
          lastCommandSequence: 0,
        })
      ).ok,
    ).toBe(true);

    const first = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-one",
      takeover: false,
    });
    const second = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-two",
      takeover: false,
    });
    expect(first.judgeActive).toBe(true);
    expect(second.judgeActive).toBe(false);

    const takeover = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-two",
      takeover: true,
    });
    expect(takeover.judgeActive).toBe(true);
    const late = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-two",
      command: {
        id: "late",
        type: "correct",
        createdAt: Date.now(),
        roundId: expiredSnapshot.roundId!,
        itemId: expiredSnapshot.itemId!,
      },
    });
    expect(late).toMatchObject({ ok: false, error: "Decision window closed" });
  });

  it("cuts off a disconnected judge and issues the host a fresh invite", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    const seated = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      ...judgeLease,
    });
    expect(seated.judgeActive).toBe(true);

    const dropped = await disconnectPairedGameJudge({
      roomId: room.roomId,
      playerToken: room.playerToken,
    });
    expect(dropped.ok).toBe(true);
    const nextJudgeToken = dropped.ok ? dropped.judgeToken : "";
    expect(nextJudgeToken).not.toBe(room.judgeToken);

    // The evicted phone cannot read the room or steer the game any more.
    const evicted = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      ...judgeLease,
    });
    expect(evicted.ok).toBe(false);
    const blocked = await sendPairedGameJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: {
        id: "after-kick",
        type: "correct",
        createdAt: Date.now(),
        roundId: snapshot.roundId!,
        itemId: snapshot.itemId!,
      },
    });
    expect(blocked.ok).toBe(false);

    // The seat is free, so a new judge can take it with the reissued invite.
    const replacement = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: nextJudgeToken,
      judgeEpoch: "judge-two",
      takeover: false,
    });
    expect(replacement.ok).toBe(true);
    expect(replacement.judgeActive).toBe(true);
  });

  it("refuses to disconnect a judge for anyone but the host", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup: headsUpSetup });
    expect(
      await disconnectPairedGameJudge({ roomId: room.roomId, playerToken: room.judgeToken }),
    ).toEqual({ ok: false });

    // In a judge-created room the judge is the host, so there is nobody to evict.
    const judgeRoom = await createPairedGameRoom({ creatorRole: "judge", setup: headsUpSetup });
    expect(
      await disconnectPairedGameJudge({
        roomId: judgeRoom.roomId,
        playerToken: judgeRoom.playerToken,
      }),
    ).toEqual({ ok: false });
  });
});
