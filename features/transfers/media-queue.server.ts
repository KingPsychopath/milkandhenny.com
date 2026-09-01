import { createHash } from "node:crypto";
import type Redis from "ioredis";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { durableWorkSnapshot } from "@/features/system/durable-work";
import { getCommandRedis } from "@/lib/platform/redis-direct.server";
import { getRedis } from "@/lib/platform/redis.server";
import type { ProcessingRoute } from "./media-state";
import type { TransferUploadFileInput } from "./upload-types";

const TRANSFER_MEDIA_QUEUE_KEY = "transfer:media:queue";
const TRANSFER_MEDIA_PROCESSING_KEY = "transfer:media:processing";
const TRANSFER_MEDIA_DEAD_KEY = "transfer:media:dead";
const TRANSFER_MEDIA_LEASE_MS = 30 * 60_000;
const TRANSFER_MEDIA_MAX_DELIVERY_ATTEMPTS = 5;

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
  idempotencyKey?: string;
  deliveryAttempt?: number;
};

type ProcessingEnvelope = {
  job: TransferMediaJob;
  lockedUntil: string;
};

function normalizedJob(job: TransferMediaJob): TransferMediaJob {
  const mediaId = job.mediaId ?? job.file.mediaId ?? job.file.name;
  return {
    ...job,
    idempotencyKey:
      job.idempotencyKey ??
      createHash("sha256")
        .update(`${job.transferId}:${mediaId}:${job.processingRoute}:${job.attempt}`)
        .digest("base64url"),
    deliveryAttempt: Math.max(0, job.deliveryAttempt ?? 0),
  };
}

function requireTransferMediaQueueRedis() {
  if (getMediaProcessorMode() === "local") {
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
  const normalized = normalizedJob(job);
  const key = `transfer:media:idempotency:${normalized.idempotencyKey}`;
  await redis.eval<unknown[], number>(
    "if redis.call('set',KEYS[1],'queued','NX','EX',ARGV[2]) then redis.call('lpush',KEYS[2],ARGV[1]); return 1 else return 0 end",
    [key, TRANSFER_MEDIA_QUEUE_KEY],
    [JSON.stringify(normalized), String(7 * 24 * 60 * 60)],
  );
}

async function dequeueTransferMediaJobs(limit: number): Promise<TransferMediaJob[]> {
  const redis = requireTransferMediaQueueRedis();
  const jobs: TransferMediaJob[] = [];

  for (let i = 0; i < limit; i += 1) {
    const raw = await redis.rpop<string>(TRANSFER_MEDIA_QUEUE_KEY);
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
  lockedUntil: string;
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

function parseProcessingEnvelope(raw: string): ProcessingEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ProcessingEnvelope>;
    if (typeof parsed.lockedUntil !== "string" || !parsed.job) return null;
    const job = parseTransferMediaJob(JSON.stringify(parsed.job));
    return job ? { job, lockedUntil: parsed.lockedUntil } : null;
  } catch {
    return null;
  }
}

function directEval(
  redis: ReturnType<typeof getCommandRedis>,
  script: string,
  keys: string[],
  args: string[],
) {
  return (
    redis as unknown as {
      eval: (source: string, keyCount: number, ...values: string[]) => Promise<unknown>;
    }
  ).eval(script, keys.length, ...keys, ...args);
}

async function claimTransferMediaJobBlocking(
  blockingRedis: Redis,
  timeoutSeconds = 0,
): Promise<ClaimedTransferMediaJob | null> {
  if (getMediaProcessorMode() === "local") {
    throw new Error("Transfer media queue is disabled.");
  }

  while (true) {
    const raw = await blockingRedis.brpoplpush(
      TRANSFER_MEDIA_QUEUE_KEY,
      TRANSFER_MEDIA_PROCESSING_KEY,
      timeoutSeconds,
    );
    if (!raw) {
      return null;
    }

    const job = parseTransferMediaJob(raw);
    if (job) {
      const lockedUntil = new Date(Date.now() + TRANSFER_MEDIA_LEASE_MS).toISOString();
      const claimedRaw = JSON.stringify({ job, lockedUntil } satisfies ProcessingEnvelope);
      const moved = await directEval(
        getCommandRedis(),
        "if redis.call('lrem',KEYS[1],1,ARGV[1])==1 then redis.call('lpush',KEYS[1],ARGV[2]); return 1 else return 0 end",
        [TRANSFER_MEDIA_PROCESSING_KEY],
        [raw, claimedRaw],
      );
      if (moved !== 1) continue;
      return { raw: claimedRaw, job, lockedUntil };
    }

    await getCommandRedis().lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
  }
}

async function ackTransferMediaJob(raw: string): Promise<void> {
  await getCommandRedis().lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
}

async function requeueTransferMediaJob(raw: string): Promise<{ permanent: boolean }> {
  const redis = getCommandRedis();
  const envelope = parseProcessingEnvelope(raw);
  const parsed = envelope?.job ?? parseTransferMediaJob(raw);
  if (!parsed) {
    await redis.lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
    return { permanent: true };
  }
  const job = normalizedJob({ ...parsed, deliveryAttempt: (parsed.deliveryAttempt ?? 0) + 1 });
  if ((job.deliveryAttempt ?? 0) >= TRANSFER_MEDIA_MAX_DELIVERY_ATTEMPTS) {
    await directEval(
      redis,
      "if redis.call('lrem',KEYS[1],1,ARGV[1])==1 then redis.call('lpush',KEYS[2],ARGV[2]); return 1 else return 0 end",
      [TRANSFER_MEDIA_PROCESSING_KEY, TRANSFER_MEDIA_DEAD_KEY],
      [raw, JSON.stringify(job)],
    );
    return { permanent: true };
  }
  await directEval(
    redis,
    "if redis.call('lrem',KEYS[1],1,ARGV[1])==1 then redis.call('lpush',KEYS[2],ARGV[2]); return 1 else return 0 end",
    [TRANSFER_MEDIA_PROCESSING_KEY, TRANSFER_MEDIA_QUEUE_KEY],
    [raw, JSON.stringify(job)],
  );
  return { permanent: false };
}

async function recoverTransferMediaProcessingJobs(): Promise<number> {
  const redis = getCommandRedis();
  const stuck = await redis.lrange(TRANSFER_MEDIA_PROCESSING_KEY, 0, -1);
  if (stuck.length === 0) return 0;
  let recovered = 0;
  for (const raw of stuck) {
    const envelope = parseProcessingEnvelope(raw);
    if (envelope && Date.parse(envelope.lockedUntil) > Date.now()) continue;
    const job = envelope?.job ?? parseTransferMediaJob(raw);
    if (job) {
      const moved = await directEval(
        redis,
        "if redis.call('lrem',KEYS[1],1,ARGV[1])==1 then redis.call('lpush',KEYS[2],ARGV[2]); return 1 else return 0 end",
        [TRANSFER_MEDIA_PROCESSING_KEY, TRANSFER_MEDIA_QUEUE_KEY],
        [raw, JSON.stringify(job)],
      );
      if (moved === 1) recovered += 1;
    } else {
      await redis.lrem(TRANSFER_MEDIA_PROCESSING_KEY, 1, raw);
      recovered += 1;
    }
  }
  return recovered;
}

async function describeTransferMediaQueue() {
  if (getMediaProcessorMode() === "local")
    return {
      enabled: false,
      queued: 0,
      leased: 0,
      permanentFailures: 0,
      backlogAgeMs: null,
      durableWork: durableWorkSnapshot({
        available: false,
        pending: 0,
        processing: 0,
        failed: 0,
        oldestPendingAt: null,
      }),
    };
  const redis = getCommandRedis();
  const [queuedJobs, leasedJobs, deadJobs] = await Promise.all([
    redis.lrange(TRANSFER_MEDIA_QUEUE_KEY, 0, -1),
    redis.lrange(TRANSFER_MEDIA_PROCESSING_KEY, 0, -1),
    redis.lrange(TRANSFER_MEDIA_DEAD_KEY, 0, -1),
  ]);
  const oldestRaw = queuedJobs.at(-1) ?? null;
  const oldest = oldestRaw ? parseTransferMediaJob(oldestRaw) : null;
  const oldestDeadRaw = deadJobs.at(-1) ?? null;
  const oldestDead = oldestDeadRaw ? parseTransferMediaJob(oldestDeadRaw) : null;
  const oldestPendingAt = oldest?.enqueuedAt ?? null;
  return {
    enabled: true,
    queued: queuedJobs.length,
    leased: leasedJobs.length,
    permanentFailures: deadJobs.length,
    oldestPermanentFailureAt: oldestDead?.enqueuedAt ?? null,
    backlogAgeMs: oldestPendingAt ? Math.max(0, Date.now() - Date.parse(oldestPendingAt)) : null,
    durableWork: durableWorkSnapshot({
      available: true,
      pending: queuedJobs.length,
      processing: leasedJobs.length,
      failed: deadJobs.length,
      oldestPendingAt,
    }),
  };
}

async function retryDeadTransferMediaJobs(limit = 25) {
  const redis = getCommandRedis();
  let retried = 0;
  while (retried < Math.max(1, Math.min(100, limit))) {
    const raw = (await redis.lrange(TRANSFER_MEDIA_DEAD_KEY, -1, -1))[0];
    if (!raw) break;
    const job = parseTransferMediaJob(raw);
    if (job)
      await directEval(
        redis,
        "if redis.call('lrem',KEYS[1],1,ARGV[1])==1 then redis.call('lpush',KEYS[2],ARGV[2]); return 1 else return 0 end",
        [TRANSFER_MEDIA_DEAD_KEY, TRANSFER_MEDIA_QUEUE_KEY],
        [raw, JSON.stringify({ ...job, deliveryAttempt: 0 })],
      );
    else await redis.lrem(TRANSFER_MEDIA_DEAD_KEY, 1, raw);
    retried += 1;
  }
  return retried;
}

export {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  dequeueTransferMediaJobs,
  describeTransferMediaQueue,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
  retryDeadTransferMediaJobs,
};

export type { ClaimedTransferMediaJob, TransferMediaJob };
