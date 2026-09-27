import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  closePairedGameRoom,
  createPairedGameRoom,
  disconnectPairedGameJudge,
  readPairedGameJudge,
  readPairedGamePlayerSetup,
  sendPairedGameJudgeCommand,
  syncPairedGamePlayer,
} from "@/features/things/remote/paired-game-room-engine.server";
import type { RemoteHeadsUpSetup, RemoteSyncedSnapshot } from "@/features/things/remote/types";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const setup: RemoteHeadsUpSetup = {
  game: "heads-up",
  deck: { name: "All sorts", cards: ["Bubble wrap", "Chess"] },
  orientation: "auto",
};
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
  connectionEpoch: "player-epoch",
  commandReceipts: [],
  updatedAt: Date.now(),
};

describeWithDatabase("Postgres paired remote rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("PAIRED_GAME_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("serializes judge commands and recovers acknowledged delivery", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup });
    expect(
      await syncPairedGamePlayer({
        roomId: room.roomId,
        playerToken: room.playerToken,
        snapshot,
        lastCommandSequence: 0,
      }),
    ).toMatchObject({ ok: true });
    const judge = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-epoch",
      takeover: false,
    });
    expect(judge).toMatchObject({ ok: true, judgeActive: true, playerConnected: true });
    const command = {
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-epoch",
      command: {
        id: "decision-1",
        type: "correct" as const,
        createdAt: Date.now(),
        roundId: snapshot.roundId!,
        itemId: snapshot.itemId!,
      },
    };
    const [first, retry] = await Promise.all([
      sendPairedGameJudgeCommand(command),
      sendPairedGameJudgeCommand(command),
    ]);
    expect(first).toMatchObject({ ok: true, sequence: 1 });
    expect(retry).toEqual(first);
    const received = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    expect(received).toMatchObject({ ok: true, commands: [{ id: "decision-1", sequence: 1 }] });
    const acknowledged = await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 1,
    });
    expect(acknowledged).toMatchObject({ ok: true, commands: [] });
  });

  it("fences player epochs, rotates judge access and keeps roles separate", async () => {
    const room = await createPairedGameRoom({ creatorRole: "player", setup });
    expect(
      await readPairedGamePlayerSetup({ roomId: room.roomId, playerToken: room.judgeToken }),
    ).toMatchObject({ ok: false });
    await syncPairedGamePlayer({
      roomId: room.roomId,
      playerToken: room.playerToken,
      snapshot,
      lastCommandSequence: 0,
    });
    expect(
      await syncPairedGamePlayer({
        roomId: room.roomId,
        playerToken: room.playerToken,
        snapshot: { ...snapshot, connectionEpoch: "other-player", revision: 2 },
        lastCommandSequence: 0,
      }),
    ).toMatchObject({ ok: false, error: "Game is active on another phone" });
    const rotated = await disconnectPairedGameJudge({
      roomId: room.roomId,
      playerToken: room.playerToken,
    });
    if (!rotated.ok) throw new Error("Expected judge rotation");
    expect(
      await readPairedGameJudge({
        roomId: room.roomId,
        judgeToken: room.judgeToken,
        judgeEpoch: "old-judge",
        takeover: false,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await readPairedGameJudge({
        roomId: room.roomId,
        judgeToken: rotated.judgeToken,
        judgeEpoch: "new-judge",
        takeover: false,
      }),
    ).toMatchObject({ ok: true, judgeActive: true });
    expect(await closePairedGameRoom(room.roomId, "player", room.playerToken)).toEqual({
      ok: true,
      closed: true,
    });
  });

  it("renews the room lease when an authorized judge returns near expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const room = await createPairedGameRoom({ creatorRole: "player", setup });
    vi.setSystemTime(Date.now() + 26 * 60_000);
    const judge = await readPairedGameJudge({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      judgeEpoch: "judge-returned",
      takeover: false,
    });
    expect(judge.ok && judge.expiresAt).toBeGreaterThan(room.expiresAt);
  });

  it("commits official results at each authoritative snapshot revision", async () => {
    const room = await createPairedGameRoom({
      creatorRole: "player",
      setup,
      officialResultChannelId: "pg-remote-result",
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
    const sync = (value: RemoteSyncedSnapshot) =>
      syncPairedGamePlayer({
        roomId: room.roomId,
        playerToken: room.playerToken,
        snapshot: value,
        lastCommandSequence: 0,
      });
    expect(await sync(completed)).toMatchObject({ ok: true });
    await sync(completed);
    await expect(sync({ ...completed, score: 9 })).rejects.toThrow(
      "Conflicting official game result revision",
    );
    await sync({ ...completed, score: 2, revision: 3 });
    expect(
      await query<{ result_id: string; revision: string }>(
        "select result_id,revision::text from multiplayer_game_result_outbox order by revision",
      ),
    ).toEqual([
      { result_id: "round:round-1", revision: "2" },
      { result_id: "round:round-1", revision: "3" },
    ]);
  });
});
