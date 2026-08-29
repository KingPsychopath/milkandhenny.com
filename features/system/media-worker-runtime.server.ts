import type Redis from "ioredis";

import { getMediaProcessorMode } from "@/features/media/config.server";
import { processWorkerJob } from "@/features/transfers/media-backends/worker.server";
import {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
} from "@/features/transfers/media-queue.server";
import { reconcileTransferMedia } from "@/features/transfers/media-reconcile.server";
import { updateTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status.server";
import { createDirectRedisClient } from "@/lib/platform/redis-direct.server";

interface DrainMediaQueuesResult {
  disabled: boolean;
  recoveredTransferJobs: number;
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface DrainMediaQueuesOptions {
  concurrency?: number;
  transferClaimTimeoutSeconds?: number;
  errorBackoffMs?: number;
  /**
   * Requeue jobs whose processing lease has expired after a crashed run.
   */
  recoverStuckJobs?: boolean;
}

type ConsumeResult = Pick<
  DrainMediaQueuesResult,
  "processedJobs" | "succeeded" | "failed" | "skipped"
>;

const DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS = 10;

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

const DEFAULT_WORKER_CONCURRENCY = positiveInteger(
  Number(process.env.MEDIA_WORKER_CONCURRENCY ?? "1"),
  1,
);
const DEFAULT_ERROR_BACKOFF_MS = positiveInteger(
  Number(process.env.MEDIA_WORKER_ERROR_BACKOFF_MS ?? "15000"),
  15_000,
);

function getReconcileIntervalMs(): number {
  const raw = Number(process.env.MEDIA_RECONCILE_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60_000;
}

function getHeartbeatIntervalMs(): number {
  const raw = Number(process.env.MEDIA_WORKER_HEARTBEAT_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.max(30_000, raw) : 5 * 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUntilAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message).slice(0, 500)
    : String(error).slice(0, 500);
}

async function heartbeat(): Promise<void> {
  await updateTransferMediaWorkerStatus({ lastHeartbeatAt: new Date().toISOString() });
}

async function markMediaJobProcessed(): Promise<void> {
  const timestamp = new Date().toISOString();
  await updateTransferMediaWorkerStatus({
    lastHeartbeatAt: timestamp,
    lastProcessedAt: timestamp,
  });
}

async function recordWorkerError(error: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const errorDetail = getErrorDetail(error);
  console.error(`[media-worker] error\n${errorDetail}`);
  try {
    await updateTransferMediaWorkerStatus({
      lastHeartbeatAt: timestamp,
      lastErrorAt: timestamp,
      lastErrorMessage: errorDetail,
    });
  } catch (statusError) {
    console.error(`[media-worker] could not persist error status\n${getErrorDetail(statusError)}`);
  }
}

function createBlockingClients(concurrency: number): Redis[] {
  return Array.from({ length: concurrency }, () => createDirectRedisClient());
}

async function closeBlockingClients(clients: Redis[]): Promise<void> {
  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}

async function consumeTransferQueue(input: {
  blockingRedis: Redis;
  claimTimeoutSeconds: number;
  errorBackoffMs: number;
  signal?: AbortSignal;
}): Promise<ConsumeResult> {
  let processedJobs = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  while (!input.signal?.aborted) {
    let claimedTransfer: Awaited<ReturnType<typeof claimTransferMediaJobBlocking>> | null = null;

    try {
      claimedTransfer = await claimTransferMediaJobBlocking(
        input.blockingRedis,
        input.claimTimeoutSeconds,
      );
      if (!claimedTransfer) break;

      const outcome = await processWorkerJob(claimedTransfer.job);
      await ackTransferMediaJob(claimedTransfer.raw);
      processedJobs += 1;
      if (outcome === "succeeded") succeeded += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
      await markMediaJobProcessed();
    } catch (error) {
      if (input.signal?.aborted && !claimedTransfer) break;

      if (claimedTransfer) {
        const deliveryAttempt = claimedTransfer.job.deliveryAttempt ?? 0;
        const backoffMs = Math.min(120_000, input.errorBackoffMs * 2 ** deliveryAttempt);
        if (input.signal) {
          await sleepUntilAbort(backoffMs, input.signal);
        } else {
          await sleep(backoffMs);
        }
        await requeueTransferMediaJob(claimedTransfer.raw);
      }

      await recordWorkerError(error);
      if (input.signal?.aborted) break;
      if (!claimedTransfer) {
        if (input.signal) await sleepUntilAbort(input.errorBackoffMs, input.signal);
        else await sleep(input.errorBackoffMs);
      }
    }
  }

  return { processedJobs, succeeded, failed, skipped };
}

async function drainMediaQueuesUntilIdle(
  options: DrainMediaQueuesOptions = {},
): Promise<DrainMediaQueuesResult> {
  if (getMediaProcessorMode() === "local") {
    return {
      disabled: true,
      recoveredTransferJobs: 0,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const claimTimeoutSeconds = Math.max(
    1,
    options.transferClaimTimeoutSeconds ?? DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS,
  );
  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONCURRENCY,
  );
  const errorBackoffMs = positiveInteger(
    options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
    DEFAULT_ERROR_BACKOFF_MS,
  );
  const recoveredTransferJobs =
    options.recoverStuckJobs === false ? 0 : await recoverTransferMediaProcessingJobs();
  const blockingClients = createBlockingClients(concurrency);

  await heartbeat();
  try {
    const loopResults = await Promise.all(
      blockingClients.map((blockingRedis) =>
        consumeTransferQueue({
          blockingRedis,
          claimTimeoutSeconds,
          errorBackoffMs,
        }),
      ),
    );
    return {
      disabled: false,
      recoveredTransferJobs,
      processedJobs: loopResults.reduce((sum, result) => sum + result.processedJobs, 0),
      succeeded: loopResults.reduce((sum, result) => sum + result.succeeded, 0),
      failed: loopResults.reduce((sum, result) => sum + result.failed, 0),
      skipped: loopResults.reduce((sum, result) => sum + result.skipped, 0),
    };
  } finally {
    await closeBlockingClients(blockingClients);
  }
}

type MediaWorkerLoop = {
  stop: () => void;
  finished: Promise<void>;
};

let activeLoop: MediaWorkerLoop | null = null;

async function runWorkerMaintenance(signal: AbortSignal, recoverStuckJobs: boolean): Promise<void> {
  const heartbeatIntervalMs = getHeartbeatIntervalMs();
  const reconcileIntervalMs = getReconcileIntervalMs();
  let nextHeartbeatAt = Date.now() + heartbeatIntervalMs;
  let nextReconcileAt = Date.now();

  while (!signal.aborted) {
    const now = Date.now();
    if (now >= nextHeartbeatAt) {
      try {
        await heartbeat();
      } catch (error) {
        if (!signal.aborted)
          console.error(`[media-worker] heartbeat failed\n${getErrorDetail(error)}`);
      }
      nextHeartbeatAt = Date.now() + heartbeatIntervalMs;
    }

    if (reconcileIntervalMs > 0 && now >= nextReconcileAt) {
      try {
        const recovered = recoverStuckJobs ? await recoverTransferMediaProcessingJobs() : 0;
        const swept = await reconcileTransferMedia();
        if (recovered > 0) {
          console.log(`[media-worker] recovered ${recovered} expired processing job(s)`);
        }
        if (swept.transfersRepaired > 0) {
          console.log(
            `[media-worker] reconciled ${swept.filesRepaired} file(s) across ${swept.transfersRepaired} transfer(s)`,
          );
        }
      } catch (error) {
        if (!signal.aborted)
          console.error(`[media-worker] reconciliation failed\n${getErrorDetail(error)}`);
      }
      nextReconcileAt = Date.now() + reconcileIntervalMs;
    }

    const nextWakeAt =
      reconcileIntervalMs > 0 ? Math.min(nextHeartbeatAt, nextReconcileAt) : nextHeartbeatAt;
    await sleepUntilAbort(Math.max(1, nextWakeAt - Date.now()), signal);
  }
}

/**
 * Start the long-running worker role.
 *
 * Every concurrency slot owns a Redis connection blocked indefinitely on the
 * queue. Idle time therefore produces no queue commands. Health and repair
 * work run on independent, deliberately low-frequency timers.
 */
function startMediaWorkerLoop(options: DrainMediaQueuesOptions = {}): void {
  if (activeLoop) return;
  if (getMediaProcessorMode() === "local") {
    console.warn(
      "[media-worker] MEDIA_PROCESSOR_MODE=local — the worker role has nothing to drain",
    );
    return;
  }

  const abortController = new AbortController();
  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONCURRENCY,
  );
  const errorBackoffMs = positiveInteger(
    options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
    DEFAULT_ERROR_BACKOFF_MS,
  );
  const blockingClients = createBlockingClients(concurrency);
  const stop = () => {
    if (abortController.signal.aborted) return;
    abortController.abort();
    for (const client of blockingClients) client.disconnect();
  };

  const finished = (async () => {
    try {
      while (!abortController.signal.aborted) {
        try {
          if (options.recoverStuckJobs !== false) await recoverTransferMediaProcessingJobs();
          await heartbeat();
          break;
        } catch (error) {
          await recordWorkerError(error);
          await sleepUntilAbort(errorBackoffMs, abortController.signal);
        }
      }
      if (abortController.signal.aborted) return;

      await Promise.all([
        ...blockingClients.map((blockingRedis) =>
          consumeTransferQueue({
            blockingRedis,
            claimTimeoutSeconds: 0,
            errorBackoffMs,
            signal: abortController.signal,
          }).then(() => undefined),
        ),
        runWorkerMaintenance(abortController.signal, options.recoverStuckJobs !== false),
      ]);
    } catch (error) {
      if (!abortController.signal.aborted) await recordWorkerError(error);
    } finally {
      if (!abortController.signal.aborted) {
        for (const client of blockingClients) client.disconnect();
      }
    }
  })();

  activeLoop = { stop, finished };
}

/** Interrupt idle blocking claims, then wait for any in-flight job to settle. */
async function stopMediaWorkerLoop(): Promise<void> {
  const loop = activeLoop;
  if (!loop) return;
  activeLoop = null;
  loop.stop();
  await loop.finished;
}

export { drainMediaQueuesUntilIdle, startMediaWorkerLoop, stopMediaWorkerLoop };
export type { DrainMediaQueuesOptions, DrainMediaQueuesResult };
