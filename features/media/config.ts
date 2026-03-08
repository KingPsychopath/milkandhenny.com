import "server-only";

import type { ProcessingRoute } from "@/features/transfers/media-state";

type MediaProcessorMode = "local" | "hybrid" | "worker";

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

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

function isWorkerEnabled(): boolean {
  return readBooleanEnv("TRANSFER_MEDIA_WORKER_ENABLED", true);
}

function isWorkerQueueEnabled(): boolean {
  return readBooleanEnv("TRANSFER_MEDIA_QUEUE_ENABLED", true);
}

function shouldRouteToWorkerFirst(route: ProcessingRoute): boolean {
  if (route === "worker_heif") {
    return readBooleanEnv("TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF", true);
  }
  if (route === "raw_try_local") {
    return readBooleanEnv("TRANSFER_MEDIA_FORCE_WORKER_FOR_RAW", false);
  }
  if (route === "local_video") {
    return readBooleanEnv("TRANSFER_MEDIA_FORCE_WORKER_FOR_VIDEO", false);
  }
  return false;
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
  isWorkerEnabled,
  isWorkerQueueEnabled,
  shouldRouteToWorkerFirst,
};

export type { MediaProcessorMode };
