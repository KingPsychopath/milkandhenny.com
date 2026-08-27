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
  request?: typeof fetch;
}

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

  if (options?.request) {
    return options.request(input.url, {
      method: "PUT",
      headers,
      body: input.body,
      signal: input.signal,
    });
  }

  return fetchWithRetry(
    input.url,
    {
      method: "PUT",
      headers,
      body: input.body,
      signal: input.signal,
    },
    {
      retries: options?.retries ?? 2,
      retryMethods: ["PUT"],
      timeoutMs: options?.timeoutMs ?? 120_000,
    },
  );
}
