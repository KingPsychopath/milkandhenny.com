function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Ceiling for work the request path still does itself.
 *
 * Nothing catches a file that blows it — heavy routes are queued before they
 * reach here — so this exists only to stop a wedged decode from holding a
 * request open. It covers streaming the original down from object storage too.
 */
function getInlineProcessingTimeoutMs(): number {
  return Math.max(0, readNumberEnv("MEDIA_INLINE_PROCESSING_TIMEOUT_MS", 120_000));
}

/** How long the worker may spend on one job before the queue reclaims it. */
function getWorkerProcessingTimeoutMs(): number {
  return Math.max(0, readNumberEnv("MEDIA_WORKER_JOB_TIMEOUT_MS", 10 * 60_000));
}

export { getInlineProcessingTimeoutMs, getWorkerProcessingTimeoutMs };
