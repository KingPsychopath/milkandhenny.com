import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyTwinAction,
  createTwinRoom,
  joinTwinRoom,
  readTwinLog,
  readTwinSnapshot,
} from "@/features/things/twin/twin-room-engine.server";
import { TWIN_TIMING } from "@/features/things/twin/twin-rules";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Twin rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("TWIN_ROOM_STORE", "postgres");
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

  it("serializes joins and fences a replay with the wrong player token", async () => {
    const room = await createTwinRoom({ hostName: "Abel", handSize: 3 });
    const join = {
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Maya",
      joinId: "maya-attempt",
      playerToken: "maya-generated-token",
    };
    const [first, retry] = await Promise.all([joinTwinRoom(join), joinTwinRoom(join)]);
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
      action: { actionId: "lock-twin", type: "room.admission.set" as const, locked: true },
    };
    const accepted = await applyTwinAction(action);
    expect(accepted.accepted).toBe(true);
    expect(await applyTwinAction(action)).toEqual(accepted);
    expect(await applyTwinAction({ ...action, playerToken: "wrong-token" })).toMatchObject({
      ok: false,
      accepted: false,
      snapshot: null,
    });
  });

  it("commits heat logs and the finished result in Postgres", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const room = await createTwinRoom({
      hostName: "Abel",
      handSize: 3,
      officialResultChannelId: "pg-twin-result",
    });
    const seat = { roomId: room.roomId, playerId: room.playerId, playerToken: room.playerToken };
    expect((await applyTwinAction({ ...seat, action: { type: "game.start" } })).accepted).toBe(
      true,
    );
    vi.setSystemTime(Date.now() + TWIN_TIMING.dealingMs + 400);
    let finished = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const view = await readTwinSnapshot({ ...seat, lastSequence: 0 });
      if (!view.ok || view.unchanged || !view.snapshot) throw new Error("Expected snapshot");
      if (view.snapshot.phase === "finished") {
        finished = true;
        break;
      }
      const heat = view.snapshot.heat;
      const top = view.snapshot.player?.top;
      if (view.snapshot.phase === "heat" && heat && top) {
        const symbolId = top.symbolIds.find((id) => heat.middle.symbolIds.includes(id));
        if (!symbolId) throw new Error("Missing matching symbol");
        await applyTwinAction({
          ...seat,
          action: { type: "answer.tap", heatId: heat.id, symbolId, elapsedMs: 800 },
        });
      }
      vi.setSystemTime(Date.now() + 900);
    }
    expect(finished).toBe(true);
    const log = await readTwinLog(seat);
    expect(log.ok && log.heats.length).toBeGreaterThan(0);
    expect(
      await query<{ result_id: string }>("select result_id from multiplayer_game_result_outbox"),
    ).toEqual([{ result_id: "game:1" }]);
    expect(
      await query<{ state: { loggedHeats?: unknown[] } }>(
        "select state from multiplayer_rooms where room_id=$1",
        [room.roomId],
      ),
    ).toMatchObject([{ state: { loggedHeats: expect.any(Array) } }]);
  });
});
