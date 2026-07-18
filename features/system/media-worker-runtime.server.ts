import { getMediaProcessorMode } from "@/features/media/config.server";
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
}

const DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS = 10;
const DEFAULT_WORD_CLAIM_TIMEOUT_SECONDS = 1;
const DEFAULT_WORKER_CONCURRENCY = Math.max(
  1,
  Number(
    process.env.MEDIA_WORKER_CONCURRENCY ??
      process.env.TRANSFER_MEDIA_WORKER_CONCURRENCY ??
      "1",
  ),
);
const DEFAULT_ERROR_BACKOFF_MS = Math.max(
  500,
  Number(
    process.env.MEDIA_WORKER_ERROR_BACKOFF_MS ??
      process.env.TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS ??
      "15000",
  ),
);

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

  const [recoveredTransferJobs, recoveredWordJobs] = await Promise.all([
    recoverTransferMediaProcessingJobs(),
    recoverWordMediaProcessingJobs(),
  ]);

  await updateTransferMediaWorkerStatus({
    lastHeartbeatAt: new Date().toISOString(),
  });

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

          await updateTransferMediaWorkerStatus({
            lastHeartbeatAt: new Date().toISOString(),
            lastProcessedAt: new Date().toISOString(),
          });
          continue;
        }

        claimedWord = await claimWordMediaJobBlocking(wordClaimTimeoutSeconds);
        if (claimedWord) {
          const outcome = await processWordMediaJob(claimedWord.job);
          await ackWordMediaJob(claimedWord.raw);
          processedJobs += 1;
          if (outcome === "succeeded") succeeded += 1;
          else skipped += 1;

          await updateTransferMediaWorkerStatus({
            lastHeartbeatAt: new Date().toISOString(),
            lastProcessedAt: new Date().toISOString(),
          });
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

export { drainMediaQueuesUntilIdle };
export type { DrainMediaQueuesOptions, DrainMediaQueuesResult };
