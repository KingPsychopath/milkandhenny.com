type ConvertedFrom = "browser_image";

interface PreparedBrowserImage {
  uploadFile: File;
  uploadName: string;
  originalFile?: File;
  convertedFrom?: ConvertedFrom;
  width?: number;
  height?: number;
}

interface PrepareBrowserImageOptions {
  archiveOriginal?: boolean;
  derivePreview?: boolean;
  forceNormalize?: boolean;
  maxDimension?: number;
  requireBrowserDecode?: boolean;
}

type WorkerResponse =
  | { id: number; ok: true; changed: false; width: number; height: number }
  | {
      id: number;
      ok: true;
      changed: true;
      bytes: ArrayBuffer;
      name: string;
      type: "image/jpeg" | "image/png" | "image/webp";
      width: number;
      height: number;
    }
  | { id: number; ok: false; error: string };

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

const HEIF_EXTENSIONS = /\.(heic|heif|hif)$/i;
const HEIF_MIME_TYPES = new Set(["image/heic", "image/heif", "image/hif"]);
const SERVER_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const EXCLUDED_IMAGE_EXTENSIONS = /\.(gif|svg)$/i;
const EXCLUDED_IMAGE_MIME_TYPES = new Set(["image/gif", "image/svg+xml"]);
const BROWSER_IMAGE_EXTENSIONS = /\.(jpe?g|jfif|png|webp|avif|heic|heif|hif|tiff?|bmp|ico|jxl)$/i;
const DEFAULT_MAX_DIMENSION = 2_560;
const MAX_BROWSER_PREP_BYTES = 200 * 1024 * 1024;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function isHeifLikeFile(file: Pick<File, "name" | "type">): boolean {
  return HEIF_EXTENSIONS.test(file.name) || HEIF_MIME_TYPES.has(file.type.toLowerCase());
}

function isBrowserImageCandidate(file: Pick<File, "name" | "type">): boolean {
  if (
    EXCLUDED_IMAGE_EXTENSIONS.test(file.name) ||
    EXCLUDED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return false;
  }
  return (
    isHeifLikeFile(file) ||
    file.type.startsWith("image/") ||
    BROWSER_IMAGE_EXTENSIONS.test(file.name)
  );
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./browser-image-prep.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    request.resolve(event.data);
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Image preparation worker failed");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

async function runWorker(
  file: File,
  maxDimension: number,
  forceNormalize: boolean,
): Promise<WorkerResponse> {
  const id = nextRequestId++;
  const bytes = await file.arrayBuffer();
  const response = new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  getWorker().postMessage(
    {
      id,
      bytes,
      name: file.name,
      type: file.type || "application/octet-stream",
      maxDimension,
      forceNormalize: forceNormalize || !SERVER_IMAGE_EXTENSIONS.test(file.name),
    },
    [bytes],
  );
  return response;
}

async function prepareBrowserImage(
  file: File,
  options: PrepareBrowserImageOptions = {},
): Promise<PreparedBrowserImage> {
  if (!options.derivePreview || !isBrowserImageCandidate(file)) {
    return { uploadFile: file, uploadName: file.name };
  }

  const heif = isHeifLikeFile(file);
  if (file.size > MAX_BROWSER_PREP_BYTES) {
    if ((heif && options.requireBrowserDecode) || options.forceNormalize) {
      throw new Error(`${file.name} is too large to prepare safely in this browser`);
    }
    return { uploadFile: file, uploadName: file.name };
  }
  try {
    const requestedMaxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
    const maxDimension = Math.round(requestedMaxDimension);
    if (!Number.isFinite(maxDimension) || maxDimension < 320 || maxDimension > 8_192) {
      throw new Error("Browser image size limit must be between 320 and 8192 pixels");
    }
    const response = await runWorker(file, maxDimension, options.forceNormalize ?? false);
    if (!response.ok) throw new Error(response.error);
    if (!response.changed) {
      return {
        uploadFile: file,
        uploadName: file.name,
        width: response.width,
        height: response.height,
      };
    }
    const prepared = new File([response.bytes], response.name, {
      type: response.type,
      lastModified: file.lastModified,
    });
    return {
      uploadFile: prepared,
      uploadName: prepared.name,
      ...(options.archiveOriginal
        ? { originalFile: file, convertedFrom: "browser_image" as const }
        : {}),
      width: response.width,
      height: response.height,
    };
  } catch (error) {
    if ((heif && options.requireBrowserDecode) || options.forceNormalize) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      throw new Error(`Could not prepare ${file.name} in this browser.${detail}`, { cause: error });
    }
    return { uploadFile: file, uploadName: file.name };
  }
}

export { isBrowserImageCandidate, isHeifLikeFile, prepareBrowserImage };
export type { ConvertedFrom, PreparedBrowserImage, PrepareBrowserImageOptions };
