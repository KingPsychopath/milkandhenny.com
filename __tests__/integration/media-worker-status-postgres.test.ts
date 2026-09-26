import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  getTransferMediaWorkerStatus,
  stopTransferMediaWorkerStatus,
  updateTransferMediaWorkerStatus,
} from "@/features/transfers/media-worker-status.server";
import { listPostgresMediaWorkerInstances } from "@/features/transfers/media-worker-status-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres media worker status", () => {
  beforeAll(async () => {
    vi.stubEnv("MEDIA_WORKER_STATUS_STORE", "postgres");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate media_worker_instances");
  });

  it("records this process separately and reads the freshest active instance", async () => {
    const old = "2026-09-26T08:00:00.000Z";
    const current = "2026-09-26T08:05:00.000Z";
    await updateTransferMediaWorkerStatus({ lastHeartbeatAt: old });
    expect((await getTransferMediaWorkerStatus()).lastHeartbeatAt).toBe(old);
    expect(await listPostgresMediaWorkerInstances()).toHaveLength(1);

    const other = randomUUID();
    await query(
      `insert into media_worker_instances
         (instance_id, deployment_id, started_at, last_heartbeat_at)
       values ($1,'synthetic',now(),$2)`,
      [other, current],
    );
    expect((await getTransferMediaWorkerStatus()).lastHeartbeatAt).toBe(current);
    expect(
      (await listPostgresMediaWorkerInstances()).map(({ deploymentId }) => deploymentId),
    ).toEqual(["synthetic", "local-worker"]);
    await stopTransferMediaWorkerStatus();
    expect(await listPostgresMediaWorkerInstances()).toHaveLength(1);
  });

  it("preserves prior timestamps when a patch supplies only an error", async () => {
    const heartbeat = "2026-09-26T08:10:00.000Z";
    await updateTransferMediaWorkerStatus({ lastHeartbeatAt: heartbeat });
    await updateTransferMediaWorkerStatus({
      lastErrorAt: "2026-09-26T08:11:00.000Z",
      lastErrorMessage: "worker_failed",
    });
    expect(await getTransferMediaWorkerStatus()).toEqual({
      lastHeartbeatAt: heartbeat,
      lastErrorAt: "2026-09-26T08:11:00.000Z",
      lastErrorMessage: "worker_failed",
    });
  });
});
