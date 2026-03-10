import "server-only";

type MediaProcessorMode = "local" | "hybrid" | "worker";
import type { ProcessingRoute } from "@/features/transfers/media-state";

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getMediaProcessorMode(): MediaProcessorMode {
  const raw = (process.env.MEDIA_PROCESSOR_MODE ?? process.env.MEDIA_PROCESSOR ?? "hybrid").toLowerCase();
  if (raw === "local" || raw === "hybrid" || raw === "worker") return raw;
  throw new Error(
    `Unsupported MEDIA_PROCESSOR_MODE "${raw}". Configure local, hybrid, or worker.`
  );
}

function getLocalProcessingTimeoutMs(route: ProcessingRoute): number {
  if (route === "raw_try_local") {
    return Math.max(0, readNumberEnv("TRANSFER_MEDIA_LOCAL_RAW_TIMEOUT_MS", 12000));
  }
  if (route === "local_video") {
    return Math.max(0, readNumberEnv("TRANSFER_MEDIA_LOCAL_VIDEO_TIMEOUT_MS", 8000));
  }
  return 0;
}

export {
  getMediaProcessorMode,
  getLocalProcessingTimeoutMs,
};

export type { MediaProcessorMode };
