import type { ProcessingRoute } from "./media-state";

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getLocalProcessingTimeoutMs(route: ProcessingRoute): number {
  if (route === "raw_try_local") {
    return Math.max(
      0,
      readNumberEnv("MEDIA_LOCAL_RAW_TIMEOUT_MS", 12_000),
    );
  }
  if (route === "local_video") {
    return Math.max(
      0,
      readNumberEnv("MEDIA_LOCAL_VIDEO_TIMEOUT_MS", 8_000),
    );
  }
  return 0;
}
