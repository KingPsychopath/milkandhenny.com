type FetchWithRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryMethods?: readonly string[];
};

const DEFAULT_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryDelay(response: Response, attempt: number, baseDelayMs: number, maxDelayMs: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateMs = Date.parse(retryAfter);
    const requestedMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(dateMs)
        ? Math.max(0, dateMs - Date.now())
        : 0;
    if (requestedMs > 0) return Math.min(requestedMs, maxDelayMs);
  }
  return Math.min(2 ** attempt * baseDelayMs, maxDelayMs);
}

function attemptSignal(parent: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

/**
 * Fetch with a small retry loop for transient failures.
 *
 * Rules:
 * - Retries only explicitly safe/idempotent methods.
 * - Retries network failures and transient HTTP statuses, honoring Retry-After.
 * - Applies a per-attempt timeout and preserves caller cancellation.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: FetchWithRetryOptions,
): Promise<Response> {
  const retries = Math.max(0, Math.floor(retryOptions?.retries ?? 2));
  const baseDelayMs = Math.max(0, Math.floor(retryOptions?.baseDelayMs ?? 500));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(retryOptions?.maxDelayMs ?? 10_000));
  const timeoutMs = Math.max(1, Math.floor(retryOptions?.timeoutMs ?? 15_000));
  const method = (options?.method ?? "GET").toUpperCase();
  const retryMethods = retryOptions?.retryMethods
    ? new Set(retryOptions.retryMethods.map((value) => value.toUpperCase()))
    : DEFAULT_RETRY_METHODS;
  const canRetryMethod = retryMethods.has(method);

  for (let i = 0; i <= retries; i++) {
    const attempt = attemptSignal(options?.signal, timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: attempt.signal });

      if (res.ok || !canRetryMethod || !RETRYABLE_STATUS.has(res.status) || i === retries) {
        return res;
      }

      const delayMs = retryDelay(res, i, baseDelayMs, maxDelayMs);
      await res.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      if (options?.signal?.aborted || !canRetryMethod || i === retries) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2 ** i * baseDelayMs, maxDelayMs)),
      );
    } finally {
      attempt.cleanup();
    }
  }

  throw new Error("Fetch failed after retries");
}
