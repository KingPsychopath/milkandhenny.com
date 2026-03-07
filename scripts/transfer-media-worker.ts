import "./r2-client";

import { runTransferMediaJobs } from "@/features/media/backends/worker";

const POLL_MS = Math.max(500, Number(process.env.TRANSFER_MEDIA_WORKER_POLL_MS ?? "5000"));
const BATCH_SIZE = Math.max(1, Number(process.env.TRANSFER_MEDIA_WORKER_BATCH_SIZE ?? "8"));
const EMPTY_BACKOFF_MS = Math.max(POLL_MS, Number(process.env.TRANSFER_MEDIA_WORKER_EMPTY_BACKOFF_MS ?? String(POLL_MS)));
const ERROR_BACKOFF_MS = Math.max(POLL_MS, Number(process.env.TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS ?? "15000"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = true;

function shutdown(signal: string) {
  console.log(`[transfer-media-worker] received ${signal}, shutting down...`);
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  console.log(`[transfer-media-worker] starting with batch size ${BATCH_SIZE}`);

  while (running) {
    try {
      const result = await runTransferMediaJobs(BATCH_SIZE);

      if (result.processedJobs > 0) {
        console.log(
          `[transfer-media-worker] processed=${result.processedJobs} ok=${result.succeeded} failed=${result.failed} skipped=${result.skipped} queue=${result.queueLength}`
        );
        await sleep(POLL_MS);
        continue;
      }

      await sleep(EMPTY_BACKOFF_MS);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`[transfer-media-worker] error\n${message}`);
      await sleep(ERROR_BACKOFF_MS);
    }
  }

  console.log("[transfer-media-worker] stopped");
}

void main();
