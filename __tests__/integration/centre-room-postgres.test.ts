import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyCentreAction,
  createCentreRoom,
  joinCentreRoom,
  readCentreReplay,
  readCentreSnapshot,
} from "@/features/things/centre/centre-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Centre rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("CENTRE_ROOM_STORE", "postgres");
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

  it("serializes joining and rejects an action replay with another credential", async () => {
    const room = await createCentreRoom({
      hostName: "Abel",
      difficulty: 2,
      delayedRivals: false,
    });
    const input = {
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Maya",
      joinId: "maya-attempt",
      playerToken: "maya-generated-token",
    };
    const [first, retry] = await Promise.all([joinCentreRoom(input), joinCentreRoom(input)]);
    if (!first.ok) throw new Error("Expected a joined player");
    expect(retry).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: first.playerToken,
    });
    const action = {
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { actionId: "lock-room", type: "room.admission.set" as const, locked: true },
    };
    const accepted = await applyCentreAction(action);
    expect(accepted.accepted).toBe(true);
    expect(await applyCentreAction(action)).toEqual(accepted);
    expect(await applyCentreAction({ ...action, playerToken: "wrong-token" })).toMatchObject({
      ok: false,
      accepted: false,
      snapshot: null,
    });
    expect(
      await readCentreSnapshot({
        roomId: room.roomId,
        playerId: first.playerId,
        playerToken: first.playerToken,
        lastSequence: 0,
      }),
    ).toMatchObject({ ok: true });
  });

  it("commits a finished result and replay with the room", async () => {
    const room = await createCentreRoom({
      hostName: "Abel",
      difficulty: 2,
      delayedRivals: false,
      officialResultChannelId: "pg-centre-result",
    });
    const seat = {
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
    };
    expect((await applyCentreAction({ ...seat, action: { type: "game.start" } })).accepted).toBe(
      true,
    );
    const armed = await applyCentreAction({
      ...seat,
      action: { type: "arming.set", armed: true },
    });
    const startsAt = armed.snapshot?.course?.startsAt;
    if (startsAt === null || startsAt === undefined) throw new Error("Expected course start");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startsAt + 10);
    const racing = await readCentreSnapshot({ ...seat, lastSequence: 0 });
    if (!racing.ok || racing.unchanged || !racing.snapshot?.course)
      throw new Error("Expected racing snapshot");
    const retired = await applyCentreAction({
      ...seat,
      action: {
        actionId: "retire-race",
        type: "race.retire",
        courseHash: racing.snapshot.course.hash,
        route: { segments: [], wallHits: 0 },
      },
    });
    expect(retired).toMatchObject({ ok: true, accepted: true, snapshot: { phase: "finished" } });
    const replay = await readCentreReplay(seat);
    expect(replay).toMatchObject({ ok: true, players: [{ playerId: room.playerId }] });
    expect(
      await query<{ result_id: string }>("select result_id from multiplayer_game_result_outbox"),
    ).toEqual([{ result_id: "game:1" }]);
    expect(
      await query<{ state: { replays?: Record<string, unknown> } }>(
        "select state from multiplayer_rooms where room_id=$1",
        [room.roomId],
      ),
    ).toMatchObject([{ state: { replays: { [room.playerId]: expect.any(Object) } } }]);
  });
});
