import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applySameBrainHostAction,
  closeSameBrainRoom,
  createSameBrainRoom,
  exportSameBrainRoom,
  importSameBrainRoom,
  joinSameBrainRoom,
  readSameBrainSnapshot,
  reissueSameBrainHostToken,
} from "@/features/things/same-brain/same-brain-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Same Brain rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("SAME_BRAIN_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("recovers concurrent joins and rejects wrong-credential action replay", async () => {
    const room = await createSameBrainRoom({ rounds: 1 });
    const join = { roomId: room.roomId, joinToken: room.joinToken, name: "Maya", joinId: "maya" };
    const [first, retry] = await Promise.all([joinSameBrainRoom(join), joinSameBrainRoom(join)]);
    if (!first.ok) throw new Error("Expected a joined player");
    expect(retry).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: first.playerToken,
    });
    const action = {
      roomId: room.roomId,
      hostToken: room.hostToken,
      action: { actionId: "lock-same-brain", type: "room.admission.set" as const, locked: true },
    };
    const accepted = await applySameBrainHostAction(action);
    expect(accepted.accepted).toBe(true);
    expect(await applySameBrainHostAction(action)).toEqual(accepted);
    expect(await applySameBrainHostAction({ ...action, hostToken: "wrong-token" })).toMatchObject({
      accepted: false,
      snapshot: null,
    });
    expect(
      await readSameBrainSnapshot({
        roomId: room.roomId,
        credential: first.playerToken,
        playerId: first.playerId,
        lastSequence: 0,
      }),
    ).toMatchObject({ ok: true });
    expect(await closeSameBrainRoom(room.roomId, "wrong-token")).toEqual({ ok: false });
    expect(await closeSameBrainRoom(room.roomId, room.hostToken)).toEqual({ ok: true });
  });

  it("commits the ending result with the accepted host command", async () => {
    const room = await createSameBrainRoom({
      rounds: 1,
      officialResultChannelId: "pg-same-brain-result",
    });
    const player = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Ava",
      joinId: "ava",
    });
    if (!player.ok) throw new Error("Expected a joined player");
    const action = {
      roomId: room.roomId,
      hostToken: room.hostToken,
      action: { actionId: "finish-same-brain", type: "game.end" as const },
    };
    const finished = await applySameBrainHostAction(action);
    expect(finished).toMatchObject({ accepted: true, snapshot: { phase: "ending" } });
    expect(await applySameBrainHostAction(action)).toEqual(finished);
    expect(
      await query<{ result_id: string }>("select result_id from multiplayer_game_result_outbox"),
    ).toEqual([{ result_id: "game:1" }]);
    expect(
      await query<{ action_id: string }>("select action_id from multiplayer_room_action_receipts"),
    ).toEqual([{ action_id: "finish-same-brain" }]);
  });

  it("restores a development room and reissues its host token without Redis", async () => {
    const room = await createSameBrainRoom({ rounds: 1 });
    const player = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Maya",
      joinId: "maya-restore",
    });
    if (!player.ok) throw new Error("Expected a joined player");
    const captured = await exportSameBrainRoom(room.roomId, room.hostToken, [
      { name: "Maya", playerId: player.playerId, playerToken: player.playerToken },
    ]);
    if (!captured) throw new Error("Expected a room export");
    const restored = await importSameBrainRoom(captured);
    if (!restored) throw new Error("Expected a restored room");
    expect(restored.roomId).not.toBe(room.roomId);
    const hostToken = await reissueSameBrainHostToken(restored.roomId);
    if (!hostToken) throw new Error("Expected a new host token");
    expect(await closeSameBrainRoom(restored.roomId, room.hostToken)).toEqual({ ok: false });
    expect(await closeSameBrainRoom(restored.roomId, hostToken)).toEqual({ ok: true });
  });
});
