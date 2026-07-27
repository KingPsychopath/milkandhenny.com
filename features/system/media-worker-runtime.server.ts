import { getMediaProcessorMode } from "@/features/media/config.server";
import { reconcileTransferMedia } from "@/features/transfers/media-reconcile.server";
import { processWorkerJob } from "@/features/transfers/media-backends/worker.server";
import { processWordMediaJob } from "@/features/words/media-worker.server";
import {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
} from "@/features/transfers/media-queue.server";
import { updateTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status.server";
import {
  ackWordMediaJob,
  claimWordMediaJobBlocking,
  recoverWordMediaProcessingJobs,
  requeueWordMediaJob,
} from "@/features/words/media-queue.server";

interface DrainMediaQueuesResult {
  disabled: boolean;
  recoveredTransferJobs: number;
  recoveredWordJobs: number;
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface DrainMediaQueuesOptions {
  concurrency?: number;
  transferClaimTimeoutSeconds?: number;
  wordClaimTimeoutSeconds?: number;
  errorBackoffMs?: number;
  /**
   * Requeue jobs stranded in the processing list by a crashed run.
   *
   * Only safe when nothing else is mid-job: a recovery sweep cannot tell a
   * crashed job from one another replica is working on right now. The
   * long-running loop recovers once at startup and never again.
   */
  recoverStuckJobs?: boolean;
}

const DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS = 10;
const DEFAULT_WORD_CLAIM_TIMEOUT_SECONDS = 1;
const DEFAULT_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.MEDIA_WORKER_CONCURRENCY ?? "1"),
);
const DEFAULT_ERROR_BACKOFF_MS = Math.max(
  500,
  Number(process.env.MEDIA_WORKER_ERROR_BACKOFF_MS ?? "15000"),
);

/**
 * How often the idle worker sweeps for stranded files. Matches the staleness
 * window, so a file goes from "claimed" to "repaired" in about two windows at
 * worst. `0` disables the sweep.
 */
function getReconcileIntervalMs(): number {
  const raw = Number(process.env.MEDIA_RECONCILE_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60_000;
}

/**
 * An idle drain pass costs one blocking claim per queue (~11s), so an
 * unthrottled loop would write a heartbeat roughly five times a minute forever.
 * Redis writes are metered — keep the liveness signal, drop the noise.
 */
const HEARTBEAT_MIN_INTERVAL_MS = 30_000;
let lastHeartbeatAtMs = 0;

async function heartbeat(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastHeartbeatAtMs < HEARTBEAT_MIN_INTERVAL_MS) return;
  lastHeartbeatAtMs = now;
  await updateTransferMediaWorkerStatus({ lastHeartbeatAt: new Date(now).toISOString() });
}

async function markMediaJobProcessed(): Promise<void> {
  const now = Date.now();
  lastHeartbeatAtMs = now;
  const timestamp = new Date(now).toISOString();
  await updateTransferMediaWorkerStatus({
    lastHeartbeatAt: timestamp,
    lastProcessedAt: timestamp,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message).slice(0, 500)
    : String(error).slice(0, 500);
}

async function drainMediaQueuesUntilIdle(
  options: DrainMediaQueuesOptions = {},
): Promise<DrainMediaQueuesResult> {
  if (getMediaProcessorMode() === "local") {
    return {
      disabled: true,
      recoveredTransferJobs: 0,
      recoveredWordJobs: 0,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const transferClaimTimeoutSeconds =
    options.transferClaimTimeoutSeconds ?? DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS;
  const wordClaimTimeoutSeconds =
    options.wordClaimTimeoutSeconds ?? DEFAULT_WORD_CLAIM_TIMEOUT_SECONDS;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_WORKER_CONCURRENCY);
  const errorBackoffMs = options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;

  const [recoveredTransferJobs, recoveredWordJobs] =
    options.recoverStuckJobs === false
      ? [0, 0]
      : await Promise.all([recoverTransferMediaProcessingJobs(), recoverWordMediaProcessingJobs()]);

  await heartbeat(true);

  async function consumeLoop(): Promise<
    Pick<DrainMediaQueuesResult, "processedJobs" | "succeeded" | "failed" | "skipped">
  > {
    let processedJobs = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    while (true) {
      let claimedTransfer: Awaited<ReturnType<typeof claimTransferMediaJobBlocking>> | null = null;
      let claimedWord: Awaited<ReturnType<typeof claimWordMediaJobBlocking>> | null = null;

      try {
        claimedTransfer = await claimTransferMediaJobBlocking(transferClaimTimeoutSeconds);
        if (claimedTransfer) {
          const outcome = await processWorkerJob(claimedTransfer.job);
          await ackTransferMediaJob(claimedTransfer.raw);
          processedJobs += 1;
          if (outcome === "succeeded") succeeded += 1;
          else if (outcome === "failed") failed += 1;
          else skipped += 1;

          await markMediaJobProcessed();
          continue;
        }

        claimedWord = await claimWordMediaJobBlocking(wordClaimTimeoutSeconds);
        if (claimedWord) {
          const outcome = await processWordMediaJob(claimedWord.job);
          await ackWordMediaJob(claimedWord.raw);
          processedJobs += 1;
          if (outcome === "succeeded") succeeded += 1;
          else skipped += 1;

          await markMediaJobProcessed();
          continue;
        }

        return { processedJobs, succeeded, failed, skipped };
      } catch (error) {
        if (claimedTransfer) {
          await requeueTransferMediaJob(claimedTransfer.raw);
        }
        if (claimedWord) {
          await requeueWordMediaJob(claimedWord.raw);
        }

        const errorDetail = getErrorDetail(error);
        lastHeartbeatAtMs = Date.now();
        await updateTransferMediaWorkerStatus({
          lastHeartbeatAt: new Date().toISOString(),
          lastErrorAt: new Date().toISOString(),
          lastErrorMessage: errorDetail,
        });
        console.error(`[media-worker] error\n${errorDetail}`);
        await sleep(errorBackoffMs);
      }
    }
  }

  const loopResults = await Promise.all(Array.from({ length: concurrency }, () => consumeLoop()));

  const processedJobs = loopResults.reduce((sum, result) => sum + result.processedJobs, 0);
  const succeeded = loopResults.reduce((sum, result) => sum + result.succeeded, 0);
  const failed = loopResults.reduce((sum, result) => sum + result.failed, 0);
  const skipped = loopResults.reduce((sum, result) => sum + result.skipped, 0);

  return {
    disabled: false,
    recoveredTransferJobs,
    recoveredWordJobs,
    processedJobs,
    succeeded,
    failed,
    skipped,
  };
}

/* ─── Long-running worker role ─── */

type MediaWorkerLoop = {
  stop: () => void;
  finished: Promise<void>;
};

let activeLoop: MediaWorkerLoop | null = null;

/**
 * Drain the media queues for as long as the process lives.
 *
 * `drainMediaQueuesUntilIdle` returns once both queues are empty; each claim
 * blocks server-side, so re-entering it is a blocking wait rather than a poll.
 * Stuck-job recovery runs only on the first pass — see `recoverStuckJobs`.
 */
function startMediaWorkerLoop(options: DrainMediaQueuesOptions = {}): void {
  if (activeLoop) return;

  const state = { stopped: false };
  const stop = () => {
    state.stopped = true;
  };

  const finished = (async () => {
    let firstPass = true;
    let lastReconcileAtMs = 0;

    while (!state.stopped) {
      try {
        const result = await drainMediaQueuesUntilIdle({
          ...options,
          recoverStuckJobs: firstPass,
        });

        if (result.disabled) {
          console.warn(
            "[media-worker] MEDIA_PROCESSOR_MODE=local — the worker role has nothing to drain, exiting loop",
          );
          return;
        }

        firstPass = false;

        // The queue is empty, so this is the cheapest moment to look for work
        // that should have been in it: files a lost job left stranded.
        const reconcileIntervalMs = getReconcileIntervalMs();
        if (reconcileIntervalMs > 0 && Date.now() - lastReconcileAtMs >= reconcileIntervalMs) {
          lastReconcileAtMs = Date.now();
          const swept = await reconcileTransferMedia();
          if (swept.transfersRepaired > 0) {
            console.log(
              `[media-worker] reconciled ${swept.filesRepaired} file(s) across ${swept.transfersRepaired} transfer(s)`,
            );
          }
        }
      } catch (error) {
        console.error(`[media-worker] drain pass failed\n${getErrorDetail(error)}`);
        await sleep(options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS);
      }
    }
  })();

  activeLoop = { stop, finished };
}

/** Stop the loop and wait for the in-flight claim to settle. */
async function stopMediaWorkerLoop(): Promise<void> {
  const loop = activeLoop;
  if (!loop) return;
  activeLoop = null;
  loop.stop();
  await loop.finished;
}

export { drainMediaQueuesUntilIdle, startMediaWorkerLoop, stopMediaWorkerLoop };
export type { DrainMediaQueuesOptions, DrainMediaQueuesResult };
