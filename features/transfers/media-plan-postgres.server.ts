import { getFileKind, getMimeType } from "@/features/media/processing.server";
import {
  classifyTransferProcessingRoute,
  getGenerationTransferAssetKeys,
  getTransferFileId,
  type ProcessingRoute,
} from "./media-state";
import type { TransferMediaJob } from "./media-queue.server";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "./storage";
import type { TransferFile } from "./types";
import type { TransferUploadFileInput } from "./upload-types";

const WORKER_ROUTE: Partial<Record<ProcessingRoute, ProcessingRoute>> = {
  local_image: "worker_image",
  local_gif: "worker_gif",
  local_video: "worker_video",
  raw_try_local: "worker_raw",
};

export function postgresWorkerRouteForFilename(filename: string): ProcessingRoute | null {
  const route = classifyTransferProcessingRoute(filename);
  if (!route) return null;
  const workerRoute = WORKER_ROUTE[route];
  if (!workerRoute) throw new Error("Unsupported Postgres transfer media route");
  return workerRoute;
}

/** Plan metadata without publishing queue work before the catalogue transaction commits. */
export function planPostgresTransferMedia(
  transferId: string,
  selectedFiles: TransferUploadFileInput[],
  enqueuedAt = new Date().toISOString(),
): { files: TransferFile[]; jobs: TransferMediaJob[] } {
  const files: TransferFile[] = [];
  const jobs: TransferMediaJob[] = [];
  for (const selected of selectedFiles) {
    const mediaId = selected.mediaId ?? getTransferFileId(selected.name);
    const storageKey = buildTransferPrimaryStorageKey(transferId, selected);
    const originalStorageKey = buildTransferArchivedOriginalStorageKey(transferId, selected);
    const mimeType = getMimeType(selected.name);
    const workerRoute = postgresWorkerRouteForFilename(selected.name);
    const file: TransferFile = {
      id: mediaId,
      filename: selected.name,
      kind: getFileKind(selected.name),
      size: selected.size,
      storedBytes: selected.size + (selected.originalSize ?? 0),
      mimeType,
      storageKey,
      ...(originalStorageKey ? { originalStorageKey } : {}),
      ...(selected.originalName ? { originalFilename: selected.originalName } : {}),
      ...(selected.originalType ? { originalMimeType: selected.originalType } : {}),
      ...(selected.convertedFrom ? { convertedFrom: selected.convertedFrom } : {}),
      previewStatus: "original_only",
      processingStatus: workerRoute ? "queued" : "skipped",
      ...(workerRoute
        ? {
            processingBackend: "worker" as const,
            processingRoute: workerRoute,
            enqueuedAt,
            retryCount: 0,
          }
        : {}),
    };
    files.push(file);
    if (workerRoute) {
      const expected = getGenerationTransferAssetKeys(
        transferId,
        selected.name,
        workerRoute,
        mediaId,
        1,
      );
      jobs.push({
        transferId,
        file: selected,
        mediaId,
        storageKey,
        expectedThumbKey: expected.thumbKey,
        expectedFullKey: expected.fullKey,
        mimeType,
        processingRoute: workerRoute,
        attempt: 1,
        enqueuedAt,
      });
    }
  }
  return { files, jobs };
}
