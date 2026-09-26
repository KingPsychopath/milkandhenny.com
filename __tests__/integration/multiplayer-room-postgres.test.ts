import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  createPostgresRoom,
  readPostgresRoom,
  transitionPostgresRoom,
} from "@/features/things/shared/room-postgres.server";
import { sealOfficialGameResult } from "@/features/game-results/outbox.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const kind = "centre";
const roomId = "pg-room-test";
const expiresAt = Date.now() + 3_600_000;

async function create() {
  expect(
    await createPostgresRoom({
      kind,
      roomId,
      schemaVersion: 1,
      revision: 0,
      state: { count: 0 },
      expiresAt,
    }),
  ).toBe(true);
}

describeWithDatabase("Postgres multiplayer room transactions", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query(
      "truncate multiplayer_room_action_receipts, multiplayer_rooms, multiplayer_game_result_outbox cascade",
    );
  });

  it("serializes concurrent actions and replays the accepted outcome", async () => {
    await create();
    const action = (id: string, fingerprintSha256: string) =>
      transitionPostgresRoom<{ count: number }, { count: number }>({
        kind,
        roomId,
        action: { id, fingerprintSha256 },
        transition: (room) => ({
          state: { count: room.state.count + 1 },
          expiresAt: room.expiresAt,
          outcome: { count: room.state.count + 1 },
        }),
      });
    const fingerprint = "a".repeat(64);
    const [first, second] = await Promise.all([
      action("same", fingerprint),
      action("same", fingerprint),
    ]);
    expect([first?.replayed, second?.replayed].sort()).toEqual([false, true]);
    expect(first?.outcome).toEqual({ count: 1 });
    expect(second?.outcome).toEqual({ count: 1 });
    await expect(action("same", "b".repeat(64))).rejects.toThrow("different input");
    await Promise.all([action("next-1", fingerprint), action("next-2", fingerprint)]);
    expect((await readPostgresRoom<{ count: number }>(kind, roomId))?.state.count).toBe(3);
  });

  it("rolls back state and receipt when the official result revision conflicts", async () => {
    await create();
    const envelope = sealOfficialGameResult({
      channelId: "channel",
      revision: 1,
      result: {
        gameKind: "centre",
        gameInstanceId: roomId,
        resultId: "result",
        scope: "game",
        players: [],
      },
    });
    const transition = (result = envelope) =>
      transitionPostgresRoom<{ count: number }, number>({
        kind,
        roomId,
        action: { id: "result-action", fingerprintSha256: "c".repeat(64) },
        transition: (room) => ({
          state: { count: room.state.count + 1 },
          expiresAt: room.expiresAt,
          outcome: 1,
          results: [result],
        }),
      });
    await query(
      `insert into multiplayer_game_result_outbox (channel_id,result_id,revision,payload_hash,envelope)
       values ($1,$2,$3,$4,$5::jsonb)`,
      [
        envelope.channelId,
        envelope.resultId,
        envelope.revision,
        "f".repeat(64),
        JSON.stringify(envelope),
      ],
    );
    await expect(transition()).rejects.toThrow("Conflicting official game result revision");
    expect((await readPostgresRoom<{ count: number }>(kind, roomId))?.state.count).toBe(0);
    expect(await query("select action_id from multiplayer_room_action_receipts")).toEqual([]);
    await query("delete from multiplayer_game_result_outbox");
    expect(await transition()).toMatchObject({ outcome: 1, replayed: false });
    expect(await query("select payload_hash from multiplayer_game_result_outbox")).toMatchObject([
      { payload_hash: envelope.payloadHash },
    ]);
  });

  it("hides expired rooms and refuses a duplicate live identity", async () => {
    await create();
    expect(
      await createPostgresRoom({
        kind,
        roomId,
        schemaVersion: 1,
        revision: 0,
        state: {},
        expiresAt,
      }),
    ).toBe(false);
    await query("update multiplayer_rooms set expires_at=clock_timestamp()-interval '1 second'");
    expect(await readPostgresRoom(kind, roomId)).toBeNull();
    expect(
      await transitionPostgresRoom({
        kind,
        roomId,
        transition: () => ({ state: {}, expiresAt, outcome: true }),
      }),
    ).toBeNull();
  });
});
