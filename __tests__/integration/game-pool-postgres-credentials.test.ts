import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  assignGamePoolRoomState,
  releaseGamePoolAssignmentState,
} from "@/features/things/pool/pool.server";
import { cleanupGamePools } from "@/features/things/pool/operations.server";
import {
  createGamePoolEntrance,
  openGamePoolRun,
  setGamePoolRunStatus,
} from "@/features/things/pool/store.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres game-pool recovery credentials", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  afterEach(() => vi.unstubAllEnvs());

  it("commits room and assignment credentials with allocation and recovers a retry", async () => {
    vi.stubEnv("GAME_POOL_CREDENTIAL_STORE", "postgres");
    vi.stubEnv("SAME_BRAIN_ROOM_STORE", "postgres");
    vi.stubEnv("OFFICIAL_GAME_RESULT_OUTBOX_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    const entrance = await createGamePoolEntrance({
      game: "same-brain",
      label: "Postgres room recovery",
    });
    const opened = await openGamePoolRun(entrance.id);
    const runId = opened?.run?.id;
    if (!runId) throw new Error("Expected an open pool run");
    try {
      const first = await assignGamePoolRoomState({
        token: entrance.token,
        clientId: "device-one-recovery",
        name: "Maya",
        choice: "new",
        moveExisting: false,
      });
      const retry = await assignGamePoolRoomState({
        token: entrance.token,
        clientId: "device-one-recovery",
        name: "Maya",
        choice: "auto",
        moveExisting: false,
      });
      expect(retry.assignment).toEqual(first.assignment);
      const second = await assignGamePoolRoomState({
        token: entrance.token,
        clientId: "device-two-recovery",
        name: "Ava",
        choice: { roomId: first.assignment.roomId },
        moveExisting: false,
      });
      expect(second.assignment.roomId).toBe(first.assignment.roomId);
      expect(second.assignment.playerId).not.toBe(first.assignment.playerId);
      expect(
        await query<{ count: string }>(
          "select count(*)::text as count from game_pool_room_credentials where run_id=$1",
          [runId],
        ),
      ).toEqual([{ count: "1" }]);
      expect(
        await query<{ count: string }>(
          "select count(*)::text as count from game_pool_assignment_receipts where run_id=$1",
          [runId],
        ),
      ).toEqual([{ count: "2" }]);
      await releaseGamePoolAssignmentState({
        token: entrance.token,
        clientId: "device-one-recovery",
      });
      expect(
        await query<{ client_id: string }>(
          "select client_id from game_pool_assignment_receipts where run_id=$1",
          [runId],
        ),
      ).toEqual([{ client_id: "device-two-recovery" }]);
      await setGamePoolRunStatus(entrance.id, "closed");
      await cleanupGamePools();
      expect(
        await query<{ count: string }>(
          "select count(*)::text as count from game_pool_room_credentials where run_id=$1",
          [runId],
        ),
      ).toEqual([{ count: "0" }]);
      expect(
        await query<{ count: string }>(
          "select count(*)::text as count from game_pool_assignment_receipts where run_id=$1",
          [runId],
        ),
      ).toEqual([{ count: "0" }]);
    } finally {
      await query("delete from game_pool_entrances where id=$1", [entrance.id]);
    }
  });
});
