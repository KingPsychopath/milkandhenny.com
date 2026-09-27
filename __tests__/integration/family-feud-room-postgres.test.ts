import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  applyFamilyFeudControllerAction,
  closeFamilyFeudRoom,
  createFamilyFeudRoom,
  pairFamilyFeudController,
  readFamilyFeudSnapshot,
} from "@/features/things/family-feud/family-feud-room-engine.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Family Feud rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("FAMILY_FEUD_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serializes one-time controller pairing and preserves action receipts", async () => {
    const room = await createFamilyFeudRoom({ rounds: 4 });
    const [first, second] = await Promise.all([
      pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
        controllerToken: "first-controller",
      }),
      pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
        controllerToken: "second-controller",
      }),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    const winner = first.ok ? first : second;
    if (!winner.ok) throw new Error("Expected one controller");
    const action = {
      roomId: room.roomId,
      controllerToken: winner.controllerToken,
      action: { type: "game.start" as const, actionId: "start" },
    };
    const [accepted, replay] = await Promise.all([
      applyFamilyFeudControllerAction(action),
      applyFamilyFeudControllerAction(action),
    ]);
    expect(accepted).toEqual(replay);
    expect(accepted.snapshot?.phase).toBe("rules");
    expect(await query("select action_id from multiplayer_room_action_receipts")).toEqual([
      { action_id: "start" },
    ]);
    expect(await closeFamilyFeudRoom(room.roomId, "wrong-controller")).toEqual({ ok: false });
    expect(await closeFamilyFeudRoom(room.roomId, winner.controllerToken)).toEqual({ ok: true });
    expect(
      await readFamilyFeudSnapshot({
        roomId: room.roomId,
        role: "controller",
        credential: winner.controllerToken,
      }),
    ).toMatchObject({ ok: false });
  });

  it("commits a confirmed result with the room transition", async () => {
    const room = await createFamilyFeudRoom({
      rounds: 4,
      officialResultChannelId: "pg-family-feud-result",
    });
    const paired = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
    });
    if (!paired.ok) throw new Error("Expected controller pairing");
    const send = (action: { type: string; actionId: string; [key: string]: unknown }) =>
      applyFamilyFeudControllerAction({
        roomId: room.roomId,
        controllerToken: paired.controllerToken,
        action: action as Parameters<typeof applyFamilyFeudControllerAction>[0]["action"],
      });
    await send({ type: "game.start", actionId: "start" });
    await send({ type: "score.adjust", teamId: "one", points: 1, actionId: "score" });
    const ended = await send({ type: "game.end", actionId: "end" });
    expect(ended.snapshot?.phase).toBe("finished");
    const confirmed = await send({ type: "result.confirm", actionId: "confirm" });
    expect(confirmed.snapshot?.resultConfirmed).toBe(true);
    expect(
      await query<{ result_id: string; status: string }>(
        "select result_id,status from multiplayer_game_result_outbox",
      ),
    ).toEqual([{ result_id: "game:1", status: "pending" }]);
  });
});
