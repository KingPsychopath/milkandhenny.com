import "server-only";

import { getBlockingRedis, getCommandRedis } from "@/lib/platform/redis-direct";
import { getRedis } from "@/lib/platform/redis";

const WORD_MEDIA_QUEUE_KEY = "word:media:queue";
const WORD_MEDIA_PROCESSING_KEY = "word:media:processing";

type WordMediaTargetJob =
  | { scope: "word"; slug: string }
  | { scope: "asset"; assetId: string };

type WordMediaJob = {
  target: WordMediaTargetJob;
  original: string;
  uploadKey: string;
  finalFilename: string;
  size: number;
  overwrote: boolean;
  enqueuedAt: string;
};

function requireWordMediaQueueRedis() {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Word media queue requires Redis/KV.");
  }
  return redis;
}

async function enqueueWordMediaJob(job: WordMediaJob): Promise<void> {
  const redis = requireWordMediaQueueRedis();
  await redis.rpush(WORD_MEDIA_QUEUE_KEY, JSON.stringify(job));
  if (process.env.NODE_ENV !== "test") {
    void fetch(
      process.env.TRANSFER_MEDIA_WORKER_WAKE_URL ?? "https://party-guest-list-transfer-worker.fly.dev/wake",
      {
        method: "POST",
        signal: AbortSignal.timeout(1500),
      }
    ).catch(() => {});
  }
}

type ClaimedWordMediaJob = {
  raw: string;
  job: WordMediaJob;
};

function parseWordMediaJob(raw: string): WordMediaJob | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.target &&
      typeof parsed.target === "object" &&
      (parsed.target.scope === "word" || parsed.target.scope === "asset") &&
      typeof parsed.original === "string" &&
      typeof parsed.uploadKey === "string" &&
      typeof parsed.finalFilename === "string" &&
      typeof parsed.size === "number" &&
      typeof parsed.overwrote === "boolean" &&
      typeof parsed.enqueuedAt === "string"
    ) {
      return parsed as WordMediaJob;
    }
  } catch {
    // Drop malformed jobs.
  }
  return null;
}

async function claimWordMediaJobBlocking(timeoutSeconds = 0): Promise<ClaimedWordMediaJob | null> {
  while (true) {
    const raw = await getBlockingRedis().brpoplpush(
      WORD_MEDIA_QUEUE_KEY,
      WORD_MEDIA_PROCESSING_KEY,
      timeoutSeconds
    );
    if (!raw) {
      return null;
    }

    const job = parseWordMediaJob(raw);
    if (job) {
      return { raw, job };
    }

    await getCommandRedis().lrem(WORD_MEDIA_PROCESSING_KEY, 1, raw);
  }
}

async function ackWordMediaJob(raw: string): Promise<void> {
  await getCommandRedis().lrem(WORD_MEDIA_PROCESSING_KEY, 1, raw);
}

async function requeueWordMediaJob(raw: string): Promise<void> {
  const redis = getCommandRedis();
  await redis.rpush(WORD_MEDIA_QUEUE_KEY, raw);
  await redis.lrem(WORD_MEDIA_PROCESSING_KEY, 1, raw);
}

async function recoverWordMediaProcessingJobs(): Promise<number> {
  const redis = getCommandRedis();
  const stuck = await redis.lrange(WORD_MEDIA_PROCESSING_KEY, 0, -1);
  if (stuck.length === 0) return 0;
  await redis.rpush(WORD_MEDIA_QUEUE_KEY, ...stuck);
  await redis.del(WORD_MEDIA_PROCESSING_KEY);
  return stuck.length;
}

export {
  ackWordMediaJob,
  claimWordMediaJobBlocking,
  enqueueWordMediaJob,
  recoverWordMediaProcessingJobs,
  requeueWordMediaJob,
};

export type { ClaimedWordMediaJob, WordMediaJob, WordMediaTargetJob };
