import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyDrawCountryAction,
  createDrawCountryRoom,
  joinDrawCountryRoom,
  readDrawCountrySnapshot,
} from "@/features/things/draw-country/draw-country-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Draw Country rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("DRAW_COUNTRY_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("keeps concurrent joins and replays an acknowledged action", async () => {
    const host = await createDrawCountryRoom({
      hostName: "Ada",
      drawSeconds: 30,
      roundTotal: 1,
      recentCountryIds: [],
    });
    const [bea, cy] = await Promise.all([
      joinDrawCountryRoom({ roomId: host.roomId, joinToken: host.joinToken, name: "Bea" }),
      joinDrawCountryRoom({ roomId: host.roomId, joinToken: host.joinToken, name: "Cy" }),
    ]);
    expect(bea.ok && cy.ok).toBe(true);
    const action = {
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "room.admission.set" as const, locked: true, actionId: "lock" },
    };
    const [first, replay] = await Promise.all([
      applyDrawCountryAction(action),
      applyDrawCountryAction(action),
    ]);
    expect(first).toEqual(replay);
    const read = await readDrawCountrySnapshot({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      lastSequence: 0,
    });
    expect(read.snapshot?.players.map(({ name }) => name).sort()).toEqual(["Ada", "Bea", "Cy"]);
    expect(read.snapshot?.joinLocked).toBe(true);
    expect(await query("select action_id from multiplayer_room_action_receipts")).toEqual([
      { action_id: "lock" },
    ]);
  });

  it("commits the finished room and official result together", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const host = await createDrawCountryRoom({
      hostName: "Ada",
      drawSeconds: 30,
      roundTotal: 1,
      recentCountryIds: [],
      officialResultChannelId: "pg-draw-country-result",
    });
    const started = await applyDrawCountryAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "start" },
    });
    vi.setSystemTime((started.snapshot?.round?.endsAt ?? 0) + 1);
    const revealed = await readDrawCountrySnapshot({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      lastSequence: 0,
    });
    vi.setSystemTime((revealed.snapshot?.round?.nextRoundAt ?? 0) + 1);
    const finished = await readDrawCountrySnapshot({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      lastSequence: 0,
    });
    expect(finished.snapshot?.phase).toBe("finished");
    expect(
      await query<{ result_id: string; status: string }>(
        "select result_id,status from multiplayer_game_result_outbox",
      ),
    ).toEqual([{ result_id: "game:1", status: "pending" }]);
  });
});
