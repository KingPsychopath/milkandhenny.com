import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  drainOfficialGameResultOutbox,
  sealOfficialGameResult,
} from "@/features/game-results/outbox.server";
import {
  claimPostgresOfficialResults,
  drainPostgresOfficialResults,
  finishPostgresOfficialResult,
} from "@/features/game-results/outbox-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

function result(id: string) {
  return sealOfficialGameResult({
    channelId: "m7-channel",
    revision: 1,
    result: {
      gameKind: "centre",
      gameInstanceId: "m7-room",
      resultId: id,
      scope: "game",
      players: [],
    },
  });
}

async function enqueue(id: string) {
  const envelope = result(id);
  await query(
    `insert into multiplayer_game_result_outbox (channel_id,result_id,revision,payload_hash,envelope)
      values ($1,$2,$3,$4,$5::jsonb)`,
    [
      envelope.channelId,
      envelope.resultId,
      envelope.revision,
      envelope.payloadHash,
      JSON.stringify(envelope),
    ],
  );
}

describeWithDatabase("Postgres official result outbox", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate multiplayer_game_result_outbox");
  });

  it("assigns disjoint claims to concurrent workers and fences stale acknowledgments", async () => {
    await enqueue("first");
    await enqueue("second");
    const [left, right] = await Promise.all([
      claimPostgresOfficialResults(1),
      claimPostgresOfficialResults(1),
    ]);
    expect(new Set([...left, ...right].map((item) => item.result_id))).toEqual(
      new Set(["first", "second"]),
    );
    const item = left[0];
    await query(
      `update multiplayer_game_result_outbox set claim_until=clock_timestamp()-interval '1 second'
        where result_id=$1`,
      [item.result_id],
    );
    const [replacement] = await claimPostgresOfficialResults(1);
    expect(replacement.result_id).toBe(item.result_id);
    expect(await finishPostgresOfficialResult(item, true)).toBe(false);
    expect(await finishPostgresOfficialResult(replacement, true)).toBe(true);
  });

  it("retries rejected delivery and retains delivered history", async () => {
    await enqueue("retry");
    expect(await drainPostgresOfficialResults(async () => false)).toEqual({
      selected: 1,
      delivered: 0,
    });
    expect(await drainPostgresOfficialResults(async () => true)).toEqual({
      selected: 0,
      delivered: 0,
    });
    await query(
      "update multiplayer_game_result_outbox set next_attempt_at=clock_timestamp()-interval '1 second'",
    );
    const consumer = vi.fn(async () => true);
    expect(await drainPostgresOfficialResults(consumer)).toEqual({ selected: 1, delivered: 1 });
    expect(consumer).toHaveBeenCalledOnce();
    expect(await drainPostgresOfficialResults(consumer)).toEqual({ selected: 0, delivered: 0 });
    expect(
      await query<{ status: string }>("select status from multiplayer_game_result_outbox"),
    ).toEqual([{ status: "delivered" }]);
  });

  it("selects Postgres when configured, even without Redis", async () => {
    await enqueue("selected");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    try {
      expect(await drainOfficialGameResultOutbox(async () => true)).toEqual({
        selected: 1,
        delivered: 1,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
