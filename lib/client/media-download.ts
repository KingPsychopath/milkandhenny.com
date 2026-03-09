"use client";

/**
 * Shared client-side download utilities.
 *
 * Single source of truth for fetching blobs from R2 (or any CORS-enabled
 * origin) and triggering browser downloads. Used by AlbumGallery,
 * TransferGallery, PhotoViewer, and useBrandedImage.
 */

const BLOB_ZIP_DOWNLOAD_LIMIT_BYTES = 200 * 1024 * 1024;

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

export { fetchBlob, downloadBlob, fetchImageForCanvas };
export { BLOB_ZIP_DOWNLOAD_LIMIT_BYTES, canUseSaveFilePicker, createZipFileWritable, fetchContentLength };
