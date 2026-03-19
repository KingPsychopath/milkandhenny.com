"use client";

/**
 * Shared client-side download utilities.
 *
 * Single source of truth for fetching blobs from R2 (or any CORS-enabled
 * origin) and triggering browser downloads. Used by AlbumGallery,
 * TransferGallery, PhotoViewer, and useBrandedImage.
 */

const BLOB_ZIP_DOWNLOAD_LIMIT_BYTES = 200 * 1024 * 1024;
const LARGE_STREAMING_ZIP_NOTICE_BYTES = 1024 * 1024 * 1024;
const PRESIGNED_DOWNLOAD_TIMEOUT_MS = 8000;
const MULTI_FILE_ZIP_URL = (process.env.NEXT_PUBLIC_MULTI_FILE_ZIP_URL ?? "").trim();
const MULTI_FILE_ZIP_MODE = (process.env.NEXT_PUBLIC_MULTI_FILE_ZIP_MODE ?? "auto")
  .trim()
  .toLowerCase();

type SingleFileDownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
};

type WorkerZipSourceFile = {
  key: string;
  filename: string;
};

type WorkerZipDownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
};

async function readResponsePayload(response: Response): Promise<{ text: string; json: unknown | null }> {
  const text = await response.text();
  if (!text) return { text, json: null };

  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: null };
  }
}

/**
 * Fetch a file as a Blob from a CORS-enabled origin.
 * @param url - The URL to fetch
 * @param retries - Number of retry attempts on transient failure (default 2)
 */
async function fetchBlob(url: string, retries = 2): Promise<Blob> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      return await res.blob();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        // Exponential backoff: 500ms, 1000ms
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function parseContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function fetchBlobWithProgress(
  url: string,
  options?: {
    retries?: number;
    signal?: AbortSignal;
    onProgress?: (progress: SingleFileDownloadProgress) => void;
  }
): Promise<Blob> {
  const retries = options?.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        mode: "cors",
        signal: options?.signal,
      });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);

      const totalBytes = parseContentLength(response.headers);
      if (!response.body) {
        const blob = await response.blob();
        options?.onProgress?.({
          receivedBytes: blob.size,
          totalBytes: totalBytes ?? blob.size,
        });
        return blob;
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      options?.onProgress?.({ receivedBytes, totalBytes });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        receivedBytes += value.byteLength;
        options?.onProgress?.({ receivedBytes, totalBytes });
      }

      return new Blob(
        chunks.map((chunk) => {
          const buffer = new ArrayBuffer(chunk.byteLength);
          new Uint8Array(buffer).set(chunk);
          return buffer;
        }),
        {
        type: response.headers.get("content-type") ?? "application/octet-stream",
        }
      );
    } catch (error) {
      if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw options?.signal?.reason instanceof Error ? options.signal.reason : error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function isIOSDownloadBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function getPresignedDownloadUrl(storageKey: string, filename: string): Promise<string> {
  const params = new URLSearchParams({
    key: storageKey,
    filename,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Timed out preparing download", "AbortError"));
  }, PRESIGNED_DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`/api/download/presign?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = `Failed to prepare download: ${response.status}`;
    try {
      const payload = await readResponsePayload(response);
      if (payload.json && typeof payload.json === "object" && "error" in payload.json) {
        const error = (payload.json as { error?: unknown }).error;
        if (typeof error === "string" && error.trim()) {
          message = error;
        }
      } else if (payload.text.trim()) {
        message = payload.text.trim();
      }
    } catch {}
    throw new Error(message);
  }

  const payload = await readResponsePayload(response);
  if (payload.json && typeof payload.json === "object" && "url" in payload.json) {
    const url = (payload.json as { url?: unknown }).url;
    if (typeof url === "string" && url.trim()) return url;
  }

  throw new Error("Failed to prepare download URL.");
}

function triggerBrowserDownload(url: string, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadViaPresignedUrl(storageKey: string, filename: string): Promise<void> {
  const url = await getPresignedDownloadUrl(storageKey, filename);
  triggerBrowserDownload(url, filename);
}

function hasWorkerZipFallbackUrl(): boolean {
  return MULTI_FILE_ZIP_URL.length > 0;
}

function shouldUseWorkerZipFallback(options: {
  pickerAvailable: boolean;
  fileCount: number;
}): boolean {
  if (options.fileCount < 2) return false;
  if (options.pickerAvailable) return false;
  if (MULTI_FILE_ZIP_MODE === "client") return false;
  return hasWorkerZipFallbackUrl();
}

async function downloadZipViaWorker(options: {
  filename: string;
  files: WorkerZipSourceFile[];
  signal?: AbortSignal;
  onProgress?: (progress: WorkerZipDownloadProgress) => void;
}): Promise<void> {
  if (!hasWorkerZipFallbackUrl()) {
    throw new Error("ZIP worker fallback is not configured.");
  }

  const response = await fetch(MULTI_FILE_ZIP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filename: options.filename,
      files: options.files,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`ZIP worker failed: ${response.status} ${response.statusText}`);
  }

  const totalBytes = parseContentLength(response.headers);
  if (!response.body) {
    const blob = await response.blob();
    options.onProgress?.({
      receivedBytes: blob.size,
      totalBytes: totalBytes ?? blob.size,
    });
    downloadBlob(blob, options.filename);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  options.onProgress?.({ receivedBytes, totalBytes });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    options.onProgress?.({ receivedBytes, totalBytes });
  }

  const blob = new Blob(
    chunks.map((chunk) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buffer).set(chunk);
      return buffer;
    }),
    {
      type: response.headers.get("content-type") ?? "application/zip",
    }
  );

  downloadBlob(blob, options.filename);
}

async function downloadFile(options: {
  storageKey: string;
  filename: string;
  fallbackUrl: string;
  onProgress?: (progress: SingleFileDownloadProgress) => void;
}): Promise<void> {
  if (!isIOSDownloadBrowser()) {
    const blob = await fetchBlobWithProgress(options.fallbackUrl, {
      onProgress: options.onProgress,
    });
    downloadBlob(blob, options.filename);
    return;
  }

  try {
    await downloadViaPresignedUrl(options.storageKey, options.filename);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const blob = await fetchBlobWithProgress(options.fallbackUrl, {
        onProgress: options.onProgress,
      });
      downloadBlob(blob, options.filename);
      return;
    }

    if (error instanceof Error && error.message.startsWith("Failed to prepare download")) {
      const blob = await fetchBlobWithProgress(options.fallbackUrl, {
        onProgress: options.onProgress,
      });
      downloadBlob(blob, options.filename);
      return;
    }

    throw error;
  }
}

/** Trigger a browser download from a Blob */
function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

interface SaveFilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFilePickerAcceptType[];
}

interface SaveFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface WindowWithSaveFilePicker extends Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandleLike>;
}

function canUseSaveFilePicker(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithSaveFilePicker).showSaveFilePicker === "function";
}

async function createZipFileWritable(filename: string): Promise<FileSystemWritableFileStream | null> {
  const picker = (window as WindowWithSaveFilePicker).showSaveFilePicker;
  if (!picker) return null;

  const handle = await picker({
    suggestedName: filename,
    types: [
      {
        description: "ZIP archive",
        accept: { "application/zip": [".zip"] },
      },
    ],
  });

  return handle.createWritable();
}

async function fetchContentLength(url: string, retries = 2): Promise<number | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { method: "HEAD", mode: "cors" });
      if (!response.ok) throw new Error(`HEAD failed: ${response.status} ${response.statusText}`);

      const raw = response.headers.get("content-length");
      if (!raw) return null;

      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`Failed to read content length for ${url}`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getZipDownloadErrorMessage(error: unknown, fallbackMessage: string): string {
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NotReadableError" || error.name === "NoModificationAllowedError")
  ) {
    return "Download failed: not enough disk space.";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("quotaexceedederror") ||
      message.includes("not enough disk space") ||
      message.includes("no space left") ||
      message.includes("disk full") ||
      message.includes("insufficient space")
    ) {
      return "Download failed: not enough disk space.";
    }

    return error.message;
  }

  return fallbackMessage;
}

/**
 * Fetch an image for Canvas drawing (CORS-safe).
 *
 * Uses `cache: "no-store"` to bypass the browser cache which may hold
 * a non-CORS response from a regular `<img>` tag on the page.
 */
async function fetchImageForCanvas(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image"));
    };
    img.src = objectUrl;
  });
}

export { downloadFile, fetchBlob, downloadBlob, downloadViaPresignedUrl, fetchImageForCanvas };
export {
  BLOB_ZIP_DOWNLOAD_LIMIT_BYTES,
  LARGE_STREAMING_ZIP_NOTICE_BYTES,
  canUseSaveFilePicker,
  createZipFileWritable,
  downloadZipViaWorker,
  fetchContentLength,
  fetchBlobWithProgress,
  getPresignedDownloadUrl,
  getZipDownloadErrorMessage,
  hasWorkerZipFallbackUrl,
  isAbortError,
  isIOSDownloadBrowser,
  parseContentLength,
  shouldUseWorkerZipFallback,
  triggerBrowserDownload,
};
export type { SingleFileDownloadProgress, WorkerZipDownloadProgress, WorkerZipSourceFile };
