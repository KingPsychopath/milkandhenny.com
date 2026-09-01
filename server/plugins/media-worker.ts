import { getMediaProcessorMode } from "@/features/media/config.server";
import { isMediaWorkerRole } from "@/features/system/media-role.server";
import {
  disposeMediaWorkerRuntime,
  startMediaWorkerLoop,
  stopMediaWorkerLoop,
} from "@/features/system/media-worker-runtime.server";
import { closeDirectRedisConnections } from "@/lib/platform/redis-direct.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

/**
 * The media worker is the same server image with `MEDIA_WORKER_ROLE=worker`.
 * It still answers `/api/health` so the platform can supervise it; the drain
 * loop just runs alongside.
 */
export default definePlugin((nitroApp) => {
  const workerRole = isMediaWorkerRole();

  const mode = getMediaProcessorMode();
  if (workerRole && mode === "local") {
    log.warn(
      "media.worker",
      "MEDIA_WORKER_ROLE=worker with MEDIA_PROCESSOR_MODE=local — nothing will be queued to drain",
    );
  } else if (workerRole) {
    startMediaWorkerLoop();
    log.info("media.worker", "Media worker role started", { mode });
  }

  nitroApp.hooks.hook("close", async () => {
    if (workerRole && mode !== "local") await stopMediaWorkerLoop();
    await disposeMediaWorkerRuntime();
    if (workerRole) {
      await closeDirectRedisConnections();
      log.info("media.worker", "Media worker role stopped");
    }
  });
});
