import "./r2-client";

import { createServer } from "node:http";
import { runTransferMediaJobs } from "@/features/media/backends/worker";
import { updateTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status";

const WORKER_ENABLED = process.env.TRANSFER_MEDIA_WORKER_ENABLED !== "0";
const PORT = Math.max(1, Number(process.env.PORT ?? "8080"));
const POLL_MS = Math.max(500, Number(process.env.TRANSFER_MEDIA_WORKER_POLL_MS ?? "2000"));
const BATCH_SIZE = Math.max(1, Number(process.env.TRANSFER_MEDIA_WORKER_BATCH_SIZE ?? "1"));
const EMPTY_BACKOFF_MS = Math.max(POLL_MS, Number(process.env.TRANSFER_MEDIA_WORKER_EMPTY_BACKOFF_MS ?? "10000"));
const ERROR_BACKOFF_MS = Math.max(POLL_MS, Number(process.env.TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS ?? "30000"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = true;
let wakeResolver: (() => void) | null = null;

function shutdown(signal: string) {
  console.log(`[transfer-media-worker] received ${signal}, shutting down...`);
  running = false;
  if (wakeResolver) {
    const resolve = wakeResolver;
    wakeResolver = null;
    resolve();
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function triggerImmediatePoll() {
  if (!wakeResolver) return;
  const resolve = wakeResolver;
  wakeResolver = null;
  resolve();
}

function waitForNextPoll(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (wakeResolver === resolveWake) {
        wakeResolver = null;
      }
      resolve();
    }, ms);

    const resolveWake = () => {
      clearTimeout(timeout);
      resolve();
    };

    wakeResolver = resolveWake;
  });
}

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === "/wake") {
    triggerImmediatePoll();
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

  console.log(`[transfer-media-worker] starting with batch size ${BATCH_SIZE}`);

  while (running) {
    try {
      await updateTransferMediaWorkerStatus({
        lastHeartbeatAt: new Date().toISOString(),
      });
      const result = await runTransferMediaJobs(BATCH_SIZE);

      if (result.processedJobs > 0) {
        await updateTransferMediaWorkerStatus({
          lastHeartbeatAt: new Date().toISOString(),
          lastProcessedAt: new Date().toISOString(),
        });
        console.log(
          `[transfer-media-worker] processed=${result.processedJobs} ok=${result.succeeded} failed=${result.failed} skipped=${result.skipped} queue=${result.queueLength}`
        );
        await waitForNextPoll(POLL_MS);
        continue;
      }

      await waitForNextPoll(EMPTY_BACKOFF_MS);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      await updateTransferMediaWorkerStatus({
        lastHeartbeatAt: new Date().toISOString(),
        lastErrorAt: new Date().toISOString(),
        lastErrorMessage: message.slice(0, 500),
      });
      console.error(`[transfer-media-worker] error\n${message}`);
      await waitForNextPoll(ERROR_BACKOFF_MS);
    }
  }

  console.log("[transfer-media-worker] stopped");
}

void main();
