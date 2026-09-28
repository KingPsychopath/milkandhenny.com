import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyPlayerAction,
  applyPresenterAction,
  closePartyRoom,
  createPartyRoom,
  joinPartyRoom,
  readPartySnapshot,
} from "@/features/things/spelling-party/party-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Spelling Party rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("SPELLING_PARTY_ROOM_STORE", "postgres");
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

  it("serializes joins and recovers the same credentials across repeated requests", async () => {
    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 20, roundTotal: 1 });
    const input = { roomId: room.roomId, joinToken: room.joinToken, name: "Maya", joinId: "maya" };
    const [first, replay] = await Promise.all([joinPartyRoom(input), joinPartyRoom(input)]);
    if (!first.ok) throw new Error("Expected joined player");
    expect(replay).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: first.playerToken,
    });
    const started = await applyPresenterAction({
      roomId: room.roomId,
      presenterToken: room.presenterToken,
      action: { actionId: "start", type: "round.start" },
    });
    expect(started.accepted).toBe(true);
    expect(
      await applyPresenterAction({
        roomId: room.roomId,
        presenterToken: "wrong-token",
        action: { actionId: "start", type: "round.start" },
      }),
    ).toMatchObject({ ok: false, accepted: false, snapshot: null });
    expect(await joinPartyRoom(input)).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: first.playerToken,
    });
    expect(
      await readPartySnapshot({
        roomId: room.roomId,
        role: "player",
        credential: first.playerToken,
        playerId: first.playerId,
        lastSequence: 0,
      }),
    ).toMatchObject({ ok: true });
    expect(await closePartyRoom(room.roomId, "wrong-token")).toEqual({ ok: false });
    expect(await closePartyRoom(room.roomId, room.presenterToken)).toEqual({ ok: true });
  });

  it("commits the finished result and accepted action receipts", async () => {
    const room = await createPartyRoom({
      deckId: "warm-up",
      answerSeconds: 10,
      roundTotal: 1,
      officialResultChannelId: "pg-spelling-result",
    });
    const player = await joinPartyRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Ava",
      joinId: "ava",
    });
    if (!player.ok) throw new Error("Expected joined player");
    const started = await applyPresenterAction({
      roomId: room.roomId,
      presenterToken: room.presenterToken,
      action: { actionId: "start-finish", type: "round.start" },
    });
    if (!started.snapshot?.round) throw new Error("Expected a round");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started.snapshot.round.answerOpensAt + 1);
    const locked = await applyPlayerAction({
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      action: {
        actionId: "lock-finish",
        type: "answer.lock",
        roundId: started.snapshot.round.roundId,
      },
    });
    if (!locked.snapshot?.round) throw new Error("Expected locked round");
    vi.setSystemTime(locked.snapshot.round.revealAt + 1);
    await readPartySnapshot({
      roomId: room.roomId,
      role: "presenter",
      credential: room.presenterToken,
      lastSequence: 0,
    });
    const action = {
      roomId: room.roomId,
      presenterToken: room.presenterToken,
      action: { actionId: "finish", type: "round.next" as const },
    };
    const finished = await applyPresenterAction(action);
    expect(finished.snapshot?.phase).toBe("finished");
    expect(await applyPresenterAction(action)).toEqual(finished);
    expect(
      await query<{ result_id: string; status: string }>(
        "select result_id,status from multiplayer_game_result_outbox",
      ),
    ).toEqual([{ result_id: "game:1", status: "pending" }]);
    expect(
      await query<{ action_id: string }>(
        "select action_id from multiplayer_room_action_receipts order by action_id",
      ),
    ).toEqual([
      { action_id: "finish" },
      { action_id: "lock-finish" },
      { action_id: "start-finish" },
    ]);
  });
});
