import "./r2-client";

import { createServer } from "node:http";
import { processWorkerJob } from "@/features/media/backends/worker";
import { processWordMediaJob } from "@/features/words/media-worker";
import { closeDirectRedisConnections } from "@/lib/platform/redis-direct";
import {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
} from "@/features/transfers/media-queue";
import {
  ackWordMediaJob,
  claimWordMediaJobBlocking,
  recoverWordMediaProcessingJobs,
  requeueWordMediaJob,
} from "@/features/words/media-queue";
import { updateTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status";

const WORKER_ENABLED = process.env.TRANSFER_MEDIA_WORKER_ENABLED !== "0";
const WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.TRANSFER_MEDIA_WORKER_CONCURRENCY ?? "1")
);
const PORT = Math.max(1, Number(process.env.PORT ?? "8080"));
const ERROR_BACKOFF_MS = Math.max(
  500,
  Number(process.env.TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS ?? "15000")
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = true;

function shutdown(signal: string) {
  console.log(`[transfer-media-worker] received ${signal}, shutting down...`);
  running = false;
  void closeDirectRedisConnections();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === "/wake") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("woken");
    return;
  }

  res.writeHead(404);
  res.end();
}).listen(PORT);

async function main() {
  if (!WORKER_ENABLED) {
    console.log("[transfer-media-worker] disabled via TRANSFER_MEDIA_WORKER_ENABLED=0");
    return;
  }

  const recovered = await recoverTransferMediaProcessingJobs();
  const recoveredWordJobs = await recoverWordMediaProcessingJobs();
  console.log(
    `[transfer-media-worker] starting with concurrency ${WORKER_CONCURRENCY}${
      recovered > 0 || recoveredWordJobs > 0
        ? ` (requeued ${recovered} transfer and ${recoveredWordJobs} word-media in-flight jobs)`
        : ""
    }`
  );

  await updateTransferMediaWorkerStatus({
    lastHeartbeatAt: new Date().toISOString(),
  });

  async function consumeLoop(index: number) {
    while (running) {
      let claimedTransfer: Awaited<ReturnType<typeof claimTransferMediaJobBlocking>> | null = null;
      let claimedWord: Awaited<ReturnType<typeof claimWordMediaJobBlocking>> | null = null;

      try {
        claimedTransfer = await claimTransferMediaJobBlocking(1);
        if (!running) break;

        if (claimedTransfer) {
          const outcome = await processWorkerJob(claimedTransfer.job);
          await ackTransferMediaJob(claimedTransfer.raw);
          await updateTransferMediaWorkerStatus({
            lastHeartbeatAt: new Date().toISOString(),
            lastProcessedAt: new Date().toISOString(),
          });
          console.log(`[transfer-media-worker] worker=${index} transfer=${outcome}`);
          continue;
        }

        claimedWord = await claimWordMediaJobBlocking(1);
        if (!running) break;

        if (claimedWord) {
          const outcome = await processWordMediaJob(claimedWord.job);
          await ackWordMediaJob(claimedWord.raw);
          await updateTransferMediaWorkerStatus({
            lastHeartbeatAt: new Date().toISOString(),
            lastProcessedAt: new Date().toISOString(),
          });
          console.log(`[transfer-media-worker] worker=${index} word-media=${outcome}`);
        }
      } catch (error) {
        if (!running) break;
        if (claimedTransfer) {
          await requeueTransferMediaJob(claimedTransfer.raw);
        }
        if (claimedWord) {
          await requeueWordMediaJob(claimedWord.raw);
        }
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        await updateTransferMediaWorkerStatus({
          lastHeartbeatAt: new Date().toISOString(),
          lastErrorAt: new Date().toISOString(),
          lastErrorMessage: message.slice(0, 500),
        });
        console.error(`[transfer-media-worker] error\n${message}`);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  await Promise.all(Array.from({ length: WORKER_CONCURRENCY }, (_, index) => consumeLoop(index + 1)));

  console.log("[transfer-media-worker] stopped");
}

void main();
