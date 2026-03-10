import { createServer, type ServerResponse } from "node:http";
import { closeDirectRedisConnections } from "@/lib/platform/redis-direct";
import { drainMediaQueuesUntilIdle, type DrainMediaQueuesResult } from "@/features/media/worker-runtime";

const PORT = Math.max(1, Number(process.env.PORT ?? "8080"));

let activeDrain: Promise<DrainMediaQueuesResult> | null = null;
let lastResult: DrainMediaQueuesResult | null = null;

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function startDrain(): boolean {
  if (activeDrain) return false;

  activeDrain = drainMediaQueuesUntilIdle()
    .then((result) => {
      lastResult = result;
      return result;
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`[transfer-media-container] drain failed\n${detail}`);
      return {
        disabled: false,
        recoveredTransferJobs: 0,
        recoveredWordJobs: 0,
        processedJobs: 0,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      } satisfies DrainMediaQueuesResult;
    })
    .finally(async () => {
      activeDrain = null;
      await closeDirectRedisConnections();
    });

  return true;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, {
      status: "ok",
      draining: activeDrain !== null,
      ...(lastResult ? { lastResult } : {}),
    });
    return;
  }

  if (req.method === "POST" && req.url === "/drain") {
    const started = startDrain();
    writeJson(res, 202, {
      status: started ? "accepted" : "already-running",
      draining: true,
    });
    return;
  }

  writeJson(res, 404, { error: "Not found" });
});

process.on("SIGINT", () => {
  server.close();
  void closeDirectRedisConnections();
});

process.on("SIGTERM", () => {
  server.close();
  void closeDirectRedisConnections();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[transfer-media-container] listening on ${PORT}`);
});
