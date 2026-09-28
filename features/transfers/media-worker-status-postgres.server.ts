import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/lib/platform/postgres.server";
import type { TransferMediaWorkerStatus } from "./media-worker-status.server";

const instanceId = randomUUID();
const deploymentId =
  process.env.MEDIA_WORKER_DEPLOYMENT_ID?.trim() ||
  process.env.RAILWAY_DEPLOYMENT_ID?.trim() ||
  "local-worker";

type StatusRow = {
  instance_id: string;
  deployment_id: string;
  last_heartbeat_at: Date | null;
  last_processed_at: Date | null;
  last_error_at: Date | null;
  last_error_message: string | null;
};

function fromRow(row: StatusRow): TransferMediaWorkerStatus {
  return {
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: row.last_heartbeat_at.toISOString() } : {}),
    ...(row.last_processed_at ? { lastProcessedAt: row.last_processed_at.toISOString() } : {}),
    ...(row.last_error_at ? { lastErrorAt: row.last_error_at.toISOString() } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
  };
}

export async function updatePostgresMediaWorkerStatus(
  patch: Partial<TransferMediaWorkerStatus>,
): Promise<void> {
  if (Object.values(patch).every((value) => !value)) return;
  await query(
    `insert into media_worker_instances
       (instance_id, deployment_id, started_at, last_heartbeat_at,
        last_processed_at, last_error_at, last_error_message)
     values ($1,$2,now(),$3,$4,$5,$6)
     on conflict (instance_id) do update set
       last_heartbeat_at=coalesce(excluded.last_heartbeat_at, media_worker_instances.last_heartbeat_at),
       last_processed_at=coalesce(excluded.last_processed_at, media_worker_instances.last_processed_at),
       last_error_at=coalesce(excluded.last_error_at, media_worker_instances.last_error_at),
       last_error_message=coalesce(excluded.last_error_message, media_worker_instances.last_error_message),
       stopped_at=null`,
    [
      instanceId,
      deploymentId,
      patch.lastHeartbeatAt ?? null,
      patch.lastProcessedAt ?? null,
      patch.lastErrorAt ?? null,
      patch.lastErrorMessage?.slice(0, 500) ?? null,
    ],
  );
}

export async function getPostgresMediaWorkerStatus(): Promise<TransferMediaWorkerStatus> {
  const row = await queryOne<StatusRow>(
    `select instance_id, deployment_id, last_heartbeat_at, last_processed_at,
            last_error_at, last_error_message
       from media_worker_instances
      where stopped_at is null
      order by last_heartbeat_at desc nulls last, started_at desc
      limit 1`,
  );
  return row ? fromRow(row) : {};
}

export async function listPostgresMediaWorkerInstances(): Promise<
  Array<{
    instanceId: string;
    deploymentId: string;
    status: TransferMediaWorkerStatus;
  }>
> {
  const rows = await query<StatusRow>(
    `select instance_id, deployment_id, last_heartbeat_at, last_processed_at,
            last_error_at, last_error_message
       from media_worker_instances
      where stopped_at is null
      order by last_heartbeat_at desc nulls last, started_at desc`,
  );
  return rows.map((row) => ({
    instanceId: row.instance_id,
    deploymentId: row.deployment_id,
    status: fromRow(row),
  }));
}

export async function stopPostgresMediaWorkerInstance(): Promise<void> {
  await query("update media_worker_instances set stopped_at=now() where instance_id=$1", [
    instanceId,
  ]);
}
