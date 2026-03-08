import "server-only";

import {
  getLocalProcessingTimeoutMs,
  shouldRouteToWorkerFirst,
  type MediaProcessorMode,
} from "@/features/media/config";
import { mapConcurrent } from "@/features/media/processing";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  didTransferFileChange,
  isTransferProcessingStale,
  type ProcessingRoute,
} from "@/features/transfers/media-state";
import { saveTransfer, type TransferData, type TransferFile } from "@/features/transfers/store";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { inferCompatibleTransferFileState, processTransferBufferLocally, processTransferObjectLocally } from "./local";
import { enqueueWorkerJob, refreshQueuedTransferState, requeueTransferFile } from "./worker";

const TRANSFER_BACKFILL_CONCURRENCY = 2;

function canUseWorkerForRoute(route: ProcessingRoute): boolean {
  return route === "worker_heif" || route === "raw_try_local" || route === "local_video";
}

class LocalProcessingTimeoutError extends Error {
  constructor(route: ProcessingRoute, timeoutMs: number) {
    super(`Local processing timed out for ${route} after ${timeoutMs}ms`);
    this.name = "LocalProcessingTimeoutError";
  }
}

async function withLocalProcessingTimeout<T>(
  route: ProcessingRoute,
  work: () => Promise<T>
): Promise<T> {
  const timeoutMs = getLocalProcessingTimeoutMs(route);
  if (timeoutMs <= 0) return work();

  return await Promise.race([
    work(),
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new LocalProcessingTimeoutError(route, timeoutMs));
      }, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

function shouldQueueBeforeLocal(mode: MediaProcessorMode, route: ProcessingRoute): boolean {
  if (!canUseWorkerForRoute(route)) return false;
  if (mode === "worker") return true;
  return shouldRouteToWorkerFirst(route);
}

async function processTransferBuffer(
  buffer: Buffer,
  file: TransferUploadFileInput,
  transferId: string,
  mode: MediaProcessorMode
) {
  const route = classifyTransferProcessingRoute(file.name);
  if (!route) {
    return processTransferBufferLocally(buffer, file, transferId);
  }

  if (shouldQueueBeforeLocal(mode, route)) {
    return enqueueWorkerJob({
      transferId,
      file: { ...file, size: buffer.byteLength },
      route,
      originalBuffer: buffer,
    });
  }

  try {
    const result = await withLocalProcessingTimeout(
      route,
      () => processTransferBufferLocally(
        buffer,
        file,
        transferId,
        "local_done",
        "local",
        route
      )
    );
    if (
      route === "raw_try_local" &&
      result.file.processingStatus === "failed" &&
      result.file.processingErrorCode === "raw_preview_unavailable"
    ) {
      return enqueueWorkerJob({
        transferId,
        file: { ...file, size: buffer.byteLength },
        route,
        originalBuffer: buffer,
      });
    }
    return result;
  } catch {
    if (!canUseWorkerForRoute(route)) {
      throw new Error(`Local processing failed for ${route}`);
    }
    return enqueueWorkerJob({
      transferId,
      file: { ...file, size: buffer.byteLength },
      route,
      originalBuffer: buffer,
    });
  }
}

async function processTransferObject(
  file: TransferUploadFileInput,
  transferId: string,
  mode: MediaProcessorMode
) {
  const route = classifyTransferProcessingRoute(file.name);
  if (!route) {
    return processTransferObjectLocally(file, transferId);
  }

  if (shouldQueueBeforeLocal(mode, route)) {
    return enqueueWorkerJob({ transferId, file, route });
  }

  try {
    const result = await withLocalProcessingTimeout(
      route,
      () => processTransferObjectLocally(
        file,
        transferId,
        "local_done",
        "local",
        route
      )
    );
    if (
      route === "raw_try_local" &&
      result.file.processingStatus === "failed" &&
      result.file.processingErrorCode === "raw_preview_unavailable"
    ) {
      return enqueueWorkerJob({ transferId, file, route });
    }
    return result;
  } catch {
    if (!canUseWorkerForRoute(route)) {
      throw new Error(`Local processing failed for ${route}`);
    }
    return enqueueWorkerJob({
      transferId,
      file,
      route,
    });
  }
}

async function repairOrQueueLegacyFile(
  transfer: TransferData,
  file: TransferFile,
  mode: MediaProcessorMode
): Promise<TransferFile> {
  const route = file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  if (!route) return file;

  if (shouldQueueBeforeLocal(mode, route)) {
    return (
      await enqueueWorkerJob({
        transferId: transfer.id,
        file: {
          name: file.filename,
          mediaId: file.id,
          size: file.size,
          type: file.mimeType,
          originalName: file.originalFilename,
          originalType: file.originalMimeType,
          originalSize: file.originalStorageKey ? file.size : undefined,
          convertedFrom: file.convertedFrom,
        },
        route,
        attempt: (file.retryCount ?? 0) + 1,
      })
    ).file;
  }

  try {
    return (
      await withLocalProcessingTimeout(
        route,
        () => processTransferObjectLocally(
          {
            name: file.filename,
            size: file.size,
            type: file.mimeType,
            originalName: file.originalFilename,
            originalType: file.originalMimeType,
            originalSize: file.originalStorageKey ? file.size : undefined,
            convertedFrom: file.convertedFrom,
          },
          transfer.id,
          "local_done",
          "local",
          route
        )
      )
    ).file;
  } catch {
    if (!canUseWorkerForRoute(route)) {
      throw new Error(`Local processing failed for ${route}`);
    }
    return (
      await enqueueWorkerJob({
        transferId: transfer.id,
        file: {
          name: file.filename,
          mediaId: file.id,
          size: file.size,
          type: file.mimeType,
          originalName: file.originalFilename,
          originalType: file.originalMimeType,
          originalSize: file.originalStorageKey ? file.size : undefined,
          convertedFrom: file.convertedFrom,
        },
        route,
        attempt: (file.retryCount ?? 0) + 1,
      })
    ).file;
  }
}

async function backfillTransferMedia(transfer: TransferData, mode: MediaProcessorMode): Promise<TransferData> {
  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return transfer;

  const refreshed = await refreshQueuedTransferState(transfer);
  let changed = refreshed !== transfer;

  const files = await mapConcurrent(
    refreshed.files,
    TRANSFER_BACKFILL_CONCURRENCY,
    async (file) => {
      const inferred = await inferCompatibleTransferFileState(refreshed.id, file);
      const compatMissing =
        !file.previewStatus || !file.processingStatus || (!file.processingRoute && inferred.processingStatus !== "skipped");

      if (didTransferFileChange(file, inferred)) {
        changed = true;
      }

      if (
        compatMissing &&
        inferred.processingStatus === "failed" &&
        inferred.processingRoute
      ) {
        changed = true;
        return repairOrQueueLegacyFile(refreshed, inferred, mode);
      }

      if (
        inferred.processingStatus === "failed" &&
        inferred.processingRoute &&
        canRetryTransferProcessing(inferred) &&
        canUseWorkerForRoute(inferred.processingRoute)
      ) {
        const retried = await requeueTransferFile(refreshed, inferred);
        if (didTransferFileChange(inferred, retried)) {
          changed = true;
        }
        return retried;
      }

      if (isTransferProcessingStale(inferred) && canRetryTransferProcessing(inferred)) {
        if (!inferred.processingRoute || !canUseWorkerForRoute(inferred.processingRoute)) {
          return inferred;
        }
        const retried = await requeueTransferFile(refreshed, inferred);
        if (didTransferFileChange(inferred, retried)) {
          changed = true;
        }
        return retried;
      }

      if (isTransferProcessingStale(inferred) && !canRetryTransferProcessing(inferred)) {
        changed = true;
        const exhausted: TransferFile = {
          ...inferred,
          previewStatus: "original_only",
          processingStatus: "failed",
          processingErrorCode: "retries_exhausted",
        };
        return exhausted;
      }

      return inferred;
    }
  );

  if (!changed) return refreshed;

  const updated = { ...refreshed, files };
  await saveTransfer(updated, remainingSeconds);
  return updated;
}

function createHybridMediaProcessor(mode: MediaProcessorMode = "hybrid") {
  return {
    processTransferBuffer: (buffer: Buffer, file: TransferUploadFileInput, transferId: string) =>
      processTransferBuffer(buffer, file, transferId, mode),
    processTransferObject: (file: TransferUploadFileInput, transferId: string) =>
      processTransferObject(file, transferId, mode),
    backfillTransferMedia: (transfer: TransferData) => backfillTransferMedia(transfer, mode),
  };
}

export { createHybridMediaProcessor };
