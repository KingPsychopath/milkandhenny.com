type FetchWithRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
};

/**
 * Fetch with a small retry loop for transient failures.
 *
 * Rules:
 * - Never retries 4xx (auth errors, bad requests, etc.).
 * - Retries network errors + 5xx responses.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: FetchWithRetryOptions
): Promise<Response> {
  const retries = Math.max(0, Math.floor(retryOptions?.retries ?? 2));
  const baseDelayMs = Math.max(0, Math.floor(retryOptions?.baseDelayMs ?? 500));

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);

      // Never retry 4xx. (This prevents accidental auth spam.)
      if (res.status >= 400 && res.status < 500) return res;

      if (res.ok || i === retries) return res;

      await new Promise((r) => setTimeout(r, Math.pow(2, i) * baseDelayMs));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * baseDelayMs));
    }
  }

  throw new Error("Fetch failed after retries");
}

