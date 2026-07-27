function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Above this, skip poster extraction rather than pulling the original through
 * a worker's disk and CPU. The video still uploads, plays, and downloads — it
 * just shows a play card instead of a poster frame.
 */
function getVideoPosterMaxBytes(): number {
  return Math.max(0, readNumberEnv("MEDIA_VIDEO_POSTER_MAX_BYTES", 2 * 1024 * 1024 * 1024));
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

class ProcessingTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`Media processing timed out for ${label} after ${timeoutMs}ms`);
    this.name = "ProcessingTimeoutError";
  }
}

/**
 * Race work against a deadline. The underlying ffmpeg/Sharp call keeps running
 * to completion in the background — this bounds how long a caller *waits*, not
 * how long the child process lives.
 */
async function withProcessingTimeout<T>(
  label: string,
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) return work();

  return await Promise.race([
    work(),
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new ProcessingTimeoutError(label, timeoutMs)),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]);
}

export {
  getInlineProcessingTimeoutMs,
  getVideoPosterMaxBytes,
  getWorkerProcessingTimeoutMs,
  ProcessingTimeoutError,
  withProcessingTimeout,
};
