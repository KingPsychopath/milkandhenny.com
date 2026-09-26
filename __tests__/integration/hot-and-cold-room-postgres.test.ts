import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyHotAndColdAction,
  createHotAndColdRoom,
  joinHotAndColdRoom,
  readHotAndColdSnapshot,
} from "@/features/things/hot-and-cold/hot-and-cold-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Hot & Cold rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("HOT_AND_COLD_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps concurrent joins and replays an acknowledged action after a fresh read", async () => {
    const host = await createHotAndColdRoom({ hostName: "Ada" });
    const [bea, cy] = await Promise.all([
      joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" }),
      joinHotAndColdRoom({ roomId: host.roomId, name: "Cy" }),
    ]);
    expect(bea.ok && cy.ok).toBe(true);
    const action = {
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "room.admission.set" as const, locked: true, actionId: "lock" },
    };
    const [first, replay] = await Promise.all([
      applyHotAndColdAction(action),
      applyHotAndColdAction(action),
    ]);
    expect(first).toEqual(replay);
    const read = await readHotAndColdSnapshot({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
    });
    expect(read.snapshot?.players.map(({ name }) => name).sort()).toEqual(["Ada", "Bea", "Cy"]);
    expect(read.snapshot?.joinLocked).toBe(true);
    expect(await query("select action_id from multiplayer_room_action_receipts")).toEqual([
      { action_id: "lock" },
    ]);
  });

  it("commits the finished room and official result together", async () => {
    const host = await createHotAndColdRoom({
      hostName: "Ada",
      rounds: 1,
      turnSeconds: 0,
      officialResultChannelId: "pg-hot-cold-result",
    });
    const guest = await joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" });
    if (!guest.ok) throw new Error("Expected guest to join");
    const started = await applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "start" },
    });
    const roundId = started.snapshot?.round?.id ?? "";
    await applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "round.giveUp", roundId, actionId: "host-give-up" },
    });
    await applyHotAndColdAction({
      roomId: host.roomId,
      playerId: guest.playerId,
      playerToken: guest.playerToken,
      action: { type: "round.giveUp", roundId, actionId: "guest-give-up" },
    });
    const finished = await applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "round.next", actionId: "finish" },
    });
    expect(finished.snapshot?.phase).toBe("finished");
    expect(
      await query<{ result_id: string; status: string }>(
        "select result_id,status from multiplayer_game_result_outbox",
      ),
    ).toEqual([{ result_id: "game:1", status: "pending" }]);
  });
});
