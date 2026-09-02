import { fetchWithRetry } from "@/lib/http/fetch-with-retry";

interface PresignedUploadInput {
  url: string;
  body: Blob;
  contentType: string;
  signal?: AbortSignal;
  cacheControl?: string;
  contentDisposition?: string;
}

interface PresignedUploadOptions {
  retries?: number;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  request?: typeof fetch;
  onProgress?: (loaded: number, total: number) => void;
  onAttempt?: (attempt: number, totalAttempts: number) => void;
}

// Direct uploads share the six-hour validity window of transfer PUT URLs. A
// short generic HTTP deadline restarts large uploads that are still progressing.
const DEFAULT_UPLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_UPLOAD_STALL_TIMEOUT_MS = 45_000;

function validatePresignedUploadUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The upload service returned an invalid destination URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The upload service returned an unsupported destination URL.");
  }
}

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator > 0) headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return headers;
}

function uploadWithProgress(
  url: string,
  init: RequestInit,
  body: Blob,
  onProgress: NonNullable<PresignedUploadOptions["onProgress"]>,
  stallTimeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = init.signal;
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallTimeoutMs);
    };
    const cleanup = () => {
      clearTimeout(stallTimer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => xhr.abort();

    xhr.open("PUT", url);
    new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.responseType = "blob";
    xhr.upload.onprogress = (event) => {
      armStallTimer();
      onProgress(event.loaded, event.lengthComputable ? event.total : body.size);
    };
    xhr.onload = () => {
      cleanup();
      onProgress(body.size, body.size);
      resolve(
        new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
        }),
      );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError("Failed to fetch"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(
        stalled
          ? new DOMException("Upload stalled while waiting for storage", "TimeoutError")
          : (signal?.reason ?? new DOMException("Request aborted", "AbortError")),
      );
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    onProgress(0, body.size);
    armStallTimer();
    xhr.send(body);
  });
}

/**
 * Shared browser transport for a server-authorised, single-object upload.
 * Product ownership, validation, finalisation, and access remain feature-owned.
 */
export async function uploadPresignedObject(
  input: PresignedUploadInput,
  options?: PresignedUploadOptions,
): Promise<Response> {
  validatePresignedUploadUrl(input.url);
  const headers = new Headers({ "Content-Type": input.contentType });
  if (input.cacheControl) headers.set("Cache-Control", input.cacheControl);
  if (input.contentDisposition) headers.set("Content-Disposition", input.contentDisposition);

  if (options?.request && !options.onProgress) {
    return options.request(input.url, {
      method: "PUT",
      headers,
      body: input.body,
      signal: input.signal,
    });
  }

  const onProgress = options?.onProgress;
  const retries = options?.retries ?? 2;
  let attempt = 0;
  const request: typeof fetch | undefined = onProgress
    ? (url: string | URL | Request, init?: RequestInit) => {
        attempt += 1;
        options?.onAttempt?.(attempt, retries + 1);
        return uploadWithProgress(
          String(url),
          init ?? {},
          input.body,
          onProgress,
          options?.stallTimeoutMs ?? DEFAULT_UPLOAD_STALL_TIMEOUT_MS,
        );
      }
    : options?.request;

  return fetchWithRetry(
    input.url,
    {
      method: "PUT",
      headers,
      body: input.body,
      signal: input.signal,
    },
    {
      retries,
      retryMethods: ["PUT"],
      timeoutMs: options?.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
      request,
    },
  );
}
