import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyLiarsHostAction,
  closeLiarsRoom,
  createLiarsRoom,
  exportLiarsRoom,
  importLiarsRoom,
  joinLiarsRoom,
  readLiarsSnapshot,
  reissueLiarsHostToken,
} from "@/features/things/liars/liars-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Liars rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("LIARS_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("recovers concurrent joins and rejects a wrong-credential action replay", async () => {
    const room = await createLiarsRoom({ mode: "mafia", roomMode: "same-room" });
    const join = { roomId: room.roomId, joinToken: room.joinToken, name: "Maya", joinId: "maya" };
    const [first, retry] = await Promise.all([joinLiarsRoom(join), joinLiarsRoom(join)]);
    if (!first.ok) throw new Error("Expected a joined player");
    expect(retry).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: first.playerToken,
    });
    const action = {
      roomId: room.roomId,
      hostToken: room.hostToken,
      action: { actionId: "lock-liars", type: "room.admission.set" as const, locked: true },
    };
    const accepted = await applyLiarsHostAction(action);
    expect(accepted.accepted).toBe(true);
    expect(await applyLiarsHostAction(action)).toEqual(accepted);
    expect(await applyLiarsHostAction({ ...action, hostToken: "wrong-token" })).toMatchObject({
      accepted: false,
      snapshot: null,
    });
    expect(
      await readLiarsSnapshot({
        roomId: room.roomId,
        credential: first.playerToken,
        playerId: first.playerId,
        lastSequence: 0,
      }),
    ).toMatchObject({ ok: true });
    expect(await closeLiarsRoom(room.roomId, "wrong-token")).toEqual({ ok: false });
    expect(await closeLiarsRoom(room.roomId, room.hostToken)).toEqual({ ok: true });
  });

  it("commits an ending result with its accepted host action", async () => {
    const room = await createLiarsRoom({
      mode: "mafia",
      roomMode: "same-room",
      officialResultChannelId: "pg-liars-result",
    });
    const player = await joinLiarsRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Ava",
      joinId: "ava",
    });
    if (!player.ok) throw new Error("Expected a joined player");
    const action = {
      roomId: room.roomId,
      hostToken: room.hostToken,
      action: { actionId: "finish-liars", type: "game.end" as const },
    };
    const finished = await applyLiarsHostAction(action);
    expect(finished).toMatchObject({ accepted: true, snapshot: { phase: "ending" } });
    expect(await applyLiarsHostAction(action)).toEqual(finished);
    expect(
      await query<{ result_id: string }>("select result_id from multiplayer_game_result_outbox"),
    ).toEqual([{ result_id: "game:1" }]);
    expect(
      await query<{ action_id: string }>("select action_id from multiplayer_room_action_receipts"),
    ).toEqual([{ action_id: "finish-liars" }]);
  });

  it("restores a development room and reissues its host token without Redis", async () => {
    const room = await createLiarsRoom({ mode: "mafia", roomMode: "same-room" });
    const player = await joinLiarsRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Maya",
      joinId: "maya-restore",
    });
    if (!player.ok) throw new Error("Expected a joined player");
    const captured = await exportLiarsRoom(room.roomId, room.hostToken, [
      { name: "Maya", playerId: player.playerId, playerToken: player.playerToken },
    ]);
    if (!captured) throw new Error("Expected a room export");
    const restored = await importLiarsRoom(captured);
    if (!restored) throw new Error("Expected a restored room");
    expect(restored.roomId).not.toBe(room.roomId);
    const hostToken = await reissueLiarsHostToken(restored.roomId);
    if (!hostToken) throw new Error("Expected a new host token");
    expect(await closeLiarsRoom(restored.roomId, room.hostToken)).toEqual({ ok: false });
    expect(await closeLiarsRoom(restored.roomId, hostToken)).toEqual({ ok: true });
  });
});
