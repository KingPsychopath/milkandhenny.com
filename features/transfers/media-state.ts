const PROCESSABLE_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|hif|tiff?)$/i;
const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;
const ANIMATED_EXTENSIONS = /\.gif$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv)$/i;
const HEIF_EXTENSIONS = /\.(heic|hif)$/i;

const PREVIEW_STATUSES = ["ready", "original_only"] as const;
const PROCESSING_STATUSES = [
  "pending",
  "skipped",
  "local_done",
  "queued",
  "processing",
  "worker_done",
  "failed",
] as const;
const PROCESSING_BACKENDS = ["local", "worker"] as const;
const PROCESSING_ROUTES = [
  "local_image",
  "local_gif",
  "local_video",
  "raw_try_local",
  "worker_heif",
  "worker_raw",
] as const;

type PreviewStatus = (typeof PREVIEW_STATUSES)[number];
type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
type ProcessingBackend = (typeof PROCESSING_BACKENDS)[number];
type ProcessingRoute = (typeof PROCESSING_ROUTES)[number];

const MAX_TRANSFER_PROCESSING_RETRIES = 3;
const TRANSFER_MEDIA_STALE_AFTER_MS = 15 * 60 * 1000;

type TransferProcessingCounts = {
  readyCount: number;
  queuedCount: number;
  failedCount: number;
  skippedCount: number;
  originalOnlyCount: number;
};

function getFilenameStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function getTransferFileId(filename: string): string {
  if (
    PROCESSABLE_IMAGE_EXTENSIONS.test(filename) ||
    RAW_IMAGE_EXTENSIONS.test(filename) ||
    ANIMATED_EXTENSIONS.test(filename) ||
    VIDEO_EXTENSIONS.test(filename)
  ) {
    return getFilenameStem(filename);
  }
  return filename;
}

function classifyTransferProcessingRoute(filename: string): ProcessingRoute | null {
  if (HEIF_EXTENSIONS.test(filename)) return "worker_heif";
  if (RAW_IMAGE_EXTENSIONS.test(filename)) return "raw_try_local";
  if (ANIMATED_EXTENSIONS.test(filename)) return "local_gif";
  if (VIDEO_EXTENSIONS.test(filename)) return "local_video";
  if (PROCESSABLE_IMAGE_EXTENSIONS.test(filename)) return "local_image";
  return null;
}

function isVisualTransferFilename(filename: string): boolean {
  return classifyTransferProcessingRoute(filename) !== null;
}

function getExpectedTransferAssetKeys(
  transferId: string,
  filename: string,
  route: ProcessingRoute | null
): { thumbKey?: string; fullKey?: string } {
  if (!route) return {};
  const id = getTransferFileId(filename);
  if (route === "local_gif") {
    return { thumbKey: `transfers/${transferId}/thumb/${id}.webp` };
  }
  return {
    thumbKey: `transfers/${transferId}/thumb/${id}.webp`,
    fullKey: `transfers/${transferId}/full/${id}.webp`,
  };
}

function buildTransferProcessingCounts<
  T extends { previewStatus?: PreviewStatus; processingStatus?: ProcessingStatus }
>(files: T[]): TransferProcessingCounts {
  return files.reduce<TransferProcessingCounts>(
    (counts, file) => {
      if (file.previewStatus === "ready") counts.readyCount += 1;
      if (file.previewStatus === "original_only") counts.originalOnlyCount += 1;
      if (file.processingStatus === "queued" || file.processingStatus === "processing") {
        counts.queuedCount += 1;
      }
      if (file.processingStatus === "failed") counts.failedCount += 1;
      if (file.processingStatus === "skipped") counts.skippedCount += 1;
      return counts;
    },
    {
      readyCount: 0,
      queuedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      originalOnlyCount: 0,
    }
  );
}

function isTransferProcessingStale(
  file: { processingStatus?: ProcessingStatus; enqueuedAt?: string; processingStartedAt?: string },
  nowMs = Date.now()
): boolean {
  if (file.processingStatus === "queued" && file.enqueuedAt) {
    return nowMs - new Date(file.enqueuedAt).getTime() > TRANSFER_MEDIA_STALE_AFTER_MS;
  }
  if (file.processingStatus === "processing" && file.processingStartedAt) {
    return nowMs - new Date(file.processingStartedAt).getTime() > TRANSFER_MEDIA_STALE_AFTER_MS;
  }
  return false;
}

function canRetryTransferProcessing(
  file: { retryCount?: number; processingStatus?: ProcessingStatus },
  force = false
): boolean {
  if (force) return true;
  if (file.processingStatus !== "failed" && file.processingStatus !== "queued" && file.processingStatus !== "processing") {
    return false;
  }
  return (file.retryCount ?? 0) < MAX_TRANSFER_PROCESSING_RETRIES;
}

export {
  ANIMATED_EXTENSIONS,
  HEIF_EXTENSIONS,
  MAX_TRANSFER_PROCESSING_RETRIES,
  PREVIEW_STATUSES,
  PROCESSABLE_IMAGE_EXTENSIONS,
  PROCESSING_BACKENDS,
  PROCESSING_ROUTES,
  PROCESSING_STATUSES,
  RAW_IMAGE_EXTENSIONS,
  TRANSFER_MEDIA_STALE_AFTER_MS,
  VIDEO_EXTENSIONS,
  buildTransferProcessingCounts,
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  getExpectedTransferAssetKeys,
  getFilenameStem,
  getTransferFileId,
  isTransferProcessingStale,
  isVisualTransferFilename,
};

export type {
  PreviewStatus,
  ProcessingBackend,
  ProcessingRoute,
  ProcessingStatus,
  TransferProcessingCounts,
};
