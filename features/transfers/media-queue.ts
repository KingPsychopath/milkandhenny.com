import "server-only";

import { isWorkerEnabled, isWorkerQueueEnabled } from "@/features/media/config";
import { getBlockingRedis, getCommandRedis } from "@/lib/platform/redis-direct";
import { getRedis } from "@/lib/platform/redis";
import type { ProcessingRoute } from "./media-state";
import type { TransferUploadFileInput } from "./upload-types";

const TRANSFER_MEDIA_QUEUE_KEY = "transfer:media:queue";
const TRANSFER_MEDIA_PROCESSING_KEY = "transfer:media:processing";

type TransferMediaJob = {
  transferId: string;
  file: TransferUploadFileInput;
  mediaId?: string;
  storageKey: string;
  expectedThumbKey?: string;
  expectedFullKey?: string;
  mimeType: string;
  processingRoute: ProcessingRoute;
  attempt: number;
  enqueuedAt: string;
};

function requireTransferMediaQueueRedis() {
  if (!isWorkerEnabled() || !isWorkerQueueEnabled()) {
    throw new Error("Transfer media queue is disabled.");
  }
  const redis = getRedis();
  if (!redis) {
    throw new Error("Transfer media queue requires Redis/KV.");
  }
  return redis;
}

async function enqueueTransferMediaJob(job: TransferMediaJob): Promise<void> {
  const redis = requireTransferMediaQueueRedis();
  await redis.rpush(TRANSFER_MEDIA_QUEUE_KEY, JSON.stringify(job));
}

async function dequeueTransferMediaJobs(limit: number): Promise<TransferMediaJob[]> {
  const redis = requireTransferMediaQueueRedis();
  const jobs: TransferMediaJob[] = [];

  for (let i = 0; i < limit; i += 1) {
    const raw = await redis.lpop<string>(TRANSFER_MEDIA_QUEUE_KEY);
    if (!raw) break;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (
        parsed &&
        typeof parsed.transferId === "string" &&
        parsed.file &&
        typeof parsed.file === "object" &&
        typeof parsed.file.name === "string" &&
        (typeof parsed.mediaId === "undefined" || typeof parsed.mediaId === "string") &&
        typeof parsed.storageKey === "string" &&
        typeof parsed.mimeType === "string" &&
        typeof parsed.processingRoute === "string" &&
        typeof parsed.attempt === "number" &&
        typeof parsed.enqueuedAt === "string"
      ) {
        jobs.push(parsed as TransferMediaJob);
      }
    } catch {
      // Drop malformed jobs rather than poisoning the queue.
    }
  }

  return jobs;
}

async function getTransferMediaQueueLength(): Promise<number> {
  const redis = requireTransferMediaQueueRedis();
  const length = await redis.llen(TRANSFER_MEDIA_QUEUE_KEY);
  return typeof length === "number" ? length : 0;
}

type ClaimedTransferMediaJob = {
  raw: string;
  job: TransferMediaJob;
};

function parseTransferMediaJob(raw: string): TransferMediaJob | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.transferId === "string" &&
      parsed.file &&
      typeof parsed.file === "object" &&
      typeof parsed.file.name === "string" &&
      (typeof parsed.mediaId === "undefined" || typeof parsed.mediaId === "string") &&
      typeof parsed.storageKey === "string" &&
      typeof parsed.mimeType === "string" &&
      typeof parsed.processingRoute === "string" &&
      typeof parsed.attempt === "number" &&
      typeof parsed.enqueuedAt === "string"
    ) {
      return parsed as TransferMediaJob;
    }
  } catch {
    // Drop malformed jobs.
  }
  return null;
}

async function claimTransferMediaJobBlocking(): Promise<ClaimedTransferMediaJob> {
  if (!isWorkerEnabled() || !isWorkerQueueEnabled()) {
    throw new Error("Transfer media queue is disabled.");
  }

  while (true) {
    const raw = await getBlockingRedis().brpoplpush(
      TRANSFER_MEDIA_QUEUE_KEY,
      TRANSFER_MEDIA_PROCESSING_KEY,
      0
    );
    if (!raw) {
      continue;
    }

    const job = parseTransferMediaJob(raw);
    if (job) {
      return { raw, job };
    }

    await getCommandRedis().lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
  }
}

async function ackTransferMediaJob(raw: string): Promise<void> {
  await getCommandRedis().lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
}

async function requeueTransferMediaJob(raw: string): Promise<void> {
  const redis = getCommandRedis();
  await redis.rpush(TRANSFER_MEDIA_QUEUE_KEY, raw);
  await redis.lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
}

async function recoverTransferMediaProcessingJobs(): Promise<number> {
  const redis = getCommandRedis();
  const stuck = await redis.lrange(TRANSFER_MEDIA_PROCESSING_KEY, 0, -1);
  if (stuck.length === 0) return 0;
  await redis.rpush(TRANSFER_MEDIA_QUEUE_KEY, ...stuck);
  await redis.del(TRANSFER_MEDIA_PROCESSING_KEY);
  return stuck.length;
}

export {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  dequeueTransferMediaJobs,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
};

export type { ClaimedTransferMediaJob, TransferMediaJob };
