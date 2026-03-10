const PROCESSABLE_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|tiff?)$/i;
const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;
const ANIMATED_EXTENSIONS = /\.gif$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv)$/i;
const HEIF_EXTENSIONS = /\.(heic|heif|hif)$/i;

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
  "worker_raw",
  "worker_image",
  "worker_gif",
  "worker_video",
] as const;

type PreviewStatus = (typeof PREVIEW_STATUSES)[number];
type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
type ProcessingBackend = (typeof PROCESSING_BACKENDS)[number];
type ProcessingRoute = (typeof PROCESSING_ROUTES)[number];

const MAX_TRANSFER_PROCESSING_RETRIES = 3;
const TRANSFER_MEDIA_STALE_AFTER_MS = 15 * 60 * 1000;
const HEIF_TRANSFER_UPLOAD_ERROR =
  "HEIC/HIF transfer uploads must be converted in the browser before upload.";

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
    HEIF_EXTENSIONS.test(filename) ||
    RAW_IMAGE_EXTENSIONS.test(filename) ||
    ANIMATED_EXTENSIONS.test(filename) ||
    VIDEO_EXTENSIONS.test(filename)
  ) {
    return getFilenameStem(filename);
  }
  return filename;
}

function buildUniqueTransferFileId(
  filename: string,
  seenIds: Set<string>
): string {
  const base = getTransferFileId(filename);
  if (!seenIds.has(base)) {
    seenIds.add(base);
    return base;
  }

  let index = 2;
  while (true) {
    const candidate = `${base}-${index}`;
    if (!seenIds.has(candidate)) {
      seenIds.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

function resolveTransferUploadIds<
  T extends { name: string }
>(files: T[], existingIds: Iterable<string> = []): Array<T & { mediaId: string }> {
  const seenIds = new Set(existingIds);
  return files.map((file) => ({
    ...file,
    mediaId: buildUniqueTransferFileId(file.name, seenIds),
  }));
}

function classifyTransferProcessingRoute(filename: string): ProcessingRoute | null {
  if (RAW_IMAGE_EXTENSIONS.test(filename)) return "raw_try_local";
  if (ANIMATED_EXTENSIONS.test(filename)) return "local_gif";
  if (VIDEO_EXTENSIONS.test(filename)) return "local_video";
  if (HEIF_EXTENSIONS.test(filename)) return "local_image";
  if (PROCESSABLE_IMAGE_EXTENSIONS.test(filename)) return "local_image";
  return null;
}

function isHeifUploadLike(file: { name: string; type?: string | null }): boolean {
  return (
    HEIF_EXTENSIONS.test(file.name) ||
    file.type?.toLowerCase() === "image/heic" ||
    file.type?.toLowerCase() === "image/heif" ||
    file.type?.toLowerCase() === "image/hif"
  );
}

function isVisualTransferFilename(filename: string): boolean {
  return classifyTransferProcessingRoute(filename) !== null;
}

function getExpectedTransferAssetKeys(
  transferId: string,
  filename: string,
  route: ProcessingRoute | null,
  mediaId: string
): { thumbKey?: string; fullKey?: string } {
  if (!route) return {};
  const id = mediaId;
  if (route === "local_gif" || route === "worker_gif") {
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

function didTransferFileChange(
  before: {
    id?: string;
    filename?: string;
    kind?: string;
    size?: number;
    mimeType?: string;
    storageKey?: string;
    originalStorageKey?: string;
    originalFilename?: string;
    originalMimeType?: string;
    convertedFrom?: string;
    previewSource?: string;
    width?: number;
    height?: number;
    takenAt?: string | null;
    livePhotoContentId?: string;
    groupId?: string;
    groupRole?: string;
    previewStatus?: PreviewStatus;
    processingStatus?: ProcessingStatus;
    processingBackend?: ProcessingBackend;
    processingRoute?: ProcessingRoute;
    enqueuedAt?: string;
    processingStartedAt?: string;
    processingCompletedAt?: string;
    processingErrorCode?: string;
    retryCount?: number;
  },
  after: {
    id?: string;
    filename?: string;
    kind?: string;
    size?: number;
    mimeType?: string;
    storageKey?: string;
    originalStorageKey?: string;
    originalFilename?: string;
    originalMimeType?: string;
    convertedFrom?: string;
    previewSource?: string;
    width?: number;
    height?: number;
    takenAt?: string | null;
    livePhotoContentId?: string;
    groupId?: string;
    groupRole?: string;
    previewStatus?: PreviewStatus;
    processingStatus?: ProcessingStatus;
    processingBackend?: ProcessingBackend;
    processingRoute?: ProcessingRoute;
    enqueuedAt?: string;
    processingStartedAt?: string;
    processingCompletedAt?: string;
    processingErrorCode?: string;
    retryCount?: number;
  }
): boolean {
  return (
    before.id !== after.id ||
    before.filename !== after.filename ||
    before.kind !== after.kind ||
    before.size !== after.size ||
    before.mimeType !== after.mimeType ||
    before.storageKey !== after.storageKey ||
    before.originalStorageKey !== after.originalStorageKey ||
    before.originalFilename !== after.originalFilename ||
    before.originalMimeType !== after.originalMimeType ||
    before.convertedFrom !== after.convertedFrom ||
    before.previewSource !== after.previewSource ||
    before.width !== after.width ||
    before.height !== after.height ||
    before.takenAt !== after.takenAt ||
    before.livePhotoContentId !== after.livePhotoContentId ||
    before.groupId !== after.groupId ||
    before.groupRole !== after.groupRole ||
    before.previewStatus !== after.previewStatus ||
    before.processingStatus !== after.processingStatus ||
    before.processingBackend !== after.processingBackend ||
    before.processingRoute !== after.processingRoute ||
    before.enqueuedAt !== after.enqueuedAt ||
    before.processingStartedAt !== after.processingStartedAt ||
    before.processingCompletedAt !== after.processingCompletedAt ||
    before.processingErrorCode !== after.processingErrorCode ||
    before.retryCount !== after.retryCount
  );
}

export {
  ANIMATED_EXTENSIONS,
  HEIF_EXTENSIONS,
  HEIF_TRANSFER_UPLOAD_ERROR,
  MAX_TRANSFER_PROCESSING_RETRIES,
  PREVIEW_STATUSES,
  PROCESSABLE_IMAGE_EXTENSIONS,
  PROCESSING_BACKENDS,
  PROCESSING_ROUTES,
  PROCESSING_STATUSES,
  RAW_IMAGE_EXTENSIONS,
  TRANSFER_MEDIA_STALE_AFTER_MS,
  VIDEO_EXTENSIONS,
  buildUniqueTransferFileId,
  buildTransferProcessingCounts,
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  didTransferFileChange,
  getExpectedTransferAssetKeys,
  getFilenameStem,
  getTransferFileId,
  isHeifUploadLike,
  resolveTransferUploadIds,
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
