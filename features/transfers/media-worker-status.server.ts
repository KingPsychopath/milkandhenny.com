import { getRedis } from "@/lib/platform/redis.server";
import {
  getPostgresMediaWorkerStatus,
  stopPostgresMediaWorkerInstance,
  updatePostgresMediaWorkerStatus,
} from "./media-worker-status-postgres.server";

const TRANSFER_MEDIA_WORKER_STATUS_KEY = "transfer:media:worker-status";

type TransferMediaWorkerStatus = {
  lastHeartbeatAt?: string;
  lastProcessedAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
};

function getTransferMediaStatusRedis() {
  return getRedis();
}

async function updateTransferMediaWorkerStatus(
  patch: Partial<TransferMediaWorkerStatus>,
): Promise<void> {
  if (process.env.MEDIA_WORKER_STATUS_STORE === "postgres")
    return updatePostgresMediaWorkerStatus(patch);
  const redis = getTransferMediaStatusRedis();
  if (!redis) return;

  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => typeof value === "string" && value.length > 0),
  );
  if (Object.keys(payload).length === 0) return;
  await redis.hset(TRANSFER_MEDIA_WORKER_STATUS_KEY, payload);
}

async function getTransferMediaWorkerStatus(): Promise<TransferMediaWorkerStatus> {
  if (process.env.MEDIA_WORKER_STATUS_STORE === "postgres") return getPostgresMediaWorkerStatus();
  const redis = getTransferMediaStatusRedis();
  if (!redis) return {};

  const raw = await redis.hgetall<Record<string, string>>(TRANSFER_MEDIA_WORKER_STATUS_KEY);
  if (!raw || typeof raw !== "object") return {};

  return {
    lastHeartbeatAt: typeof raw.lastHeartbeatAt === "string" ? raw.lastHeartbeatAt : undefined,
    lastProcessedAt: typeof raw.lastProcessedAt === "string" ? raw.lastProcessedAt : undefined,
    lastErrorAt: typeof raw.lastErrorAt === "string" ? raw.lastErrorAt : undefined,
    lastErrorMessage: typeof raw.lastErrorMessage === "string" ? raw.lastErrorMessage : undefined,
  };
}

async function stopTransferMediaWorkerStatus(): Promise<void> {
  if (process.env.MEDIA_WORKER_STATUS_STORE === "postgres") await stopPostgresMediaWorkerInstance();
}

export {
  getTransferMediaWorkerStatus,
  stopTransferMediaWorkerStatus,
  updateTransferMediaWorkerStatus,
};
export type { TransferMediaWorkerStatus };
