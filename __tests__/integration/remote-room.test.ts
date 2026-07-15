import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  closeRemoteRoom,
  createRemoteRoom,
  readRemoteJudge,
  readRemotePlayerSetup,
  sendRemoteJudgeCommand,
  syncRemotePlayer,
} from "../../features/things/remote/remote-room.server";
import { remoteGameSetup } from "../../features/things/remote/remote-room.functions";
import type { RemoteHeadsUpSetup, RemoteSpellingSetup, RemoteSyncedSnapshot } from "../../features/things/remote/types";

const headsUpSetup: RemoteHeadsUpSetup = {
  game: "heads-up",
  deck: { name: "All sorts", cards: ["Bubble wrap", "Chess", "Big Ben"] },
  positionLock: false,
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

describe("remote game rooms", () => {
  it("lets a player-created room invite a judge and delivers acknowledged commands once", async () => {
    const room = await createRemoteRoom({ creatorRole: "player", setup: headsUpSetup });
    const initial = await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot, lastCommandSequence: 0 });
    expect(initial.ok).toBe(true);

    const judge = await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken, ...judgeLease });
    expect(judge.snapshot?.currentLabel).toBe("Bubble wrap");
    expect(judge.playerConnected).toBe(true);

    await sendRemoteJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: { id: "decision-1", type: "correct", createdAt: Date.now(), roundId: snapshot.roundId!, itemId: snapshot.itemId! },
    });
    const received = await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot, lastCommandSequence: 0 });
    expect(received.commands).toHaveLength(1);

    const acknowledged = await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot, lastCommandSequence: received.commands[0].sequence });
    expect(acknowledged.commands).toHaveLength(0);
  });

  it("lets a judge-created room transfer setup to the player without transferring device preferences", async () => {
    const room = await createRemoteRoom({ creatorRole: "judge", setup: spellingSetup });
    const player = await readRemotePlayerSetup({ roomId: room.roomId, playerToken: room.playerToken });

    expect(player.ok).toBe(true);
    expect(player.setup).toEqual(spellingSetup);
    expect(player.judgeConnected).toBe(true);
    expect(player.setup).not.toHaveProperty("soundEnabled");
    expect(player.setup).not.toHaveProperty("microphonePermission");
  });

  it("keeps role credentials separate and only lets the room creator close from the judge role", async () => {
    const playerCreated = await createRemoteRoom({ creatorRole: "player", setup: headsUpSetup });
    expect((await readRemotePlayerSetup({ roomId: playerCreated.roomId, playerToken: playerCreated.judgeToken })).ok).toBe(false);
    expect((await readRemoteJudge({ roomId: playerCreated.roomId, judgeToken: playerCreated.playerToken, ...judgeLease })).ok).toBe(false);
    expect((await closeRemoteRoom(playerCreated.roomId, "judge", playerCreated.judgeToken)).ok).toBe(false);
    expect((await closeRemoteRoom(playerCreated.roomId, "player", playerCreated.playerToken)).ok).toBe(true);
    expect((await closeRemoteRoom(playerCreated.roomId, "player", playerCreated.playerToken)).ok).toBe(true);

    const judgeCreated = await createRemoteRoom({ creatorRole: "judge", setup: spellingSetup });
    expect((await closeRemoteRoom(judgeCreated.roomId, "judge", judgeCreated.judgeToken)).ok).toBe(true);
  });

  it("rejects oversized setup payloads at the server boundary", () => {
    expect(() => remoteGameSetup({ game: "heads-up", deck: { name: "Too large", cards: Array.from({ length: 201 }, () => "card") } })).toThrow("Invalid deck");
    expect(() => remoteGameSetup({ game: "spelling-bee", deck: { name: "Too small", words: [] } })).toThrow("Invalid deck");
  });

  it("rejects stale and future-dated judge commands", async () => {
    const room = await createRemoteRoom({ creatorRole: "player", setup: headsUpSetup });
    const target = { roundId: "round-1", itemId: "round-1:card-1" };
    const stale = await sendRemoteJudgeCommand({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: judgeLease.judgeEpoch, command: { id: "stale", type: "correct", createdAt: Date.now() - 20_000, ...target } });
    const future = await sendRemoteJudgeCommand({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: judgeLease.judgeEpoch, command: { id: "future", type: "correct", createdAt: Date.now() + 20_000, ...target } });
    expect(stale.ok).toBe(false);
    expect(future.ok).toBe(false);
  });

  it("fences duplicate player tabs, preserves newer snapshots, and rejects stale item targets", async () => {
    const room = await createRemoteRoom({ creatorRole: "player", setup: headsUpSetup });
    const newer = { ...snapshot, currentLabel: "Chess", itemId: "round-1:card-2", revision: 2 };
    expect((await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot: newer, lastCommandSequence: 0 })).ok).toBe(true);

    const older = { ...snapshot, revision: 1 };
    expect((await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot: older, lastCommandSequence: 0 })).ok).toBe(true);
    expect((await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken, ...judgeLease })).snapshot?.currentLabel).toBe("Chess");

    const duplicateTab = { ...newer, connectionEpoch: "connection-2", revision: 3 };
    const fenced = await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot: duplicateTab, lastCommandSequence: 0 });
    expect(fenced).toMatchObject({ ok: false, error: "Game is active on another phone" });

    const staleTarget = await sendRemoteJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: judgeLease.judgeEpoch,
      command: { id: "late-decision", type: "correct", createdAt: Date.now(), roundId: "round-1", itemId: "round-1:card-1" },
    });
    expect(staleTarget).toMatchObject({ ok: false, error: "Card changed" });
  });

  it("gives one judge control, supports explicit takeover, and rejects decisions received after the deadline", async () => {
    const room = await createRemoteRoom({ creatorRole: "player", setup: spellingSetup });
    const expiredSnapshot: RemoteSyncedSnapshot = { ...snapshot, game: "spelling-bee", decisionClosesAt: Date.now() - 1, connectionEpoch: "deadline-player" };
    expect((await syncRemotePlayer({ roomId: room.roomId, playerToken: room.playerToken, snapshot: expiredSnapshot, lastCommandSequence: 0 })).ok).toBe(true);

    const first = await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: "judge-one", takeover: false });
    const second = await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: "judge-two", takeover: false });
    expect(first.judgeActive).toBe(true);
    expect(second.judgeActive).toBe(false);

    const takeover = await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: "judge-two", takeover: true });
    expect(takeover.judgeActive).toBe(true);
    const late = await sendRemoteJudgeCommand({ roomId: room.roomId, judgeToken: room.judgeToken, judgeEpoch: "judge-two", command: { id: "late", type: "correct", createdAt: Date.now(), roundId: expiredSnapshot.roundId!, itemId: expiredSnapshot.itemId! } });
    expect(late).toMatchObject({ ok: false, error: "Decision window closed" });
  });
});
