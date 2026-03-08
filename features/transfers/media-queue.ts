import "server-only";

import { isWorkerEnabled, isWorkerQueueEnabled } from "@/features/media/config";
import { getRedis } from "@/lib/platform/redis";
import type { ProcessingRoute } from "./media-state";
import type { TransferUploadFileInput } from "./upload-types";

const TRANSFER_MEDIA_QUEUE_KEY = "transfer:media:queue";

type TransferMediaJob = {
  transferId: string;
  file: TransferUploadFileInput;
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

export {
  dequeueTransferMediaJobs,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
};

export type { TransferMediaJob };
