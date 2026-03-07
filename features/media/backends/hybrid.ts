import "server-only";

import { mapConcurrent } from "@/features/media/processing";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  isTransferProcessingStale,
  type ProcessingRoute,
} from "@/features/transfers/media-state";
import { saveTransfer, type TransferData, type TransferFile } from "@/features/transfers/store";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { inferCompatibleTransferFileState, processTransferBufferLocally, processTransferObjectLocally } from "./local";
import { enqueueWorkerJob, refreshQueuedTransferState, requeueTransferFile } from "./worker";

const TRANSFER_BACKFILL_CONCURRENCY = 2;

async function processTransferBuffer(
  buffer: Buffer,
  filename: string,
  transferId: string
) {
  const route = classifyTransferProcessingRoute(filename);
  if (!route) {
    return processTransferBufferLocally(buffer, filename, transferId);
  }

  try {
    return await processTransferBufferLocally(buffer, filename, transferId, "local_done", "local", route);
  } catch {
    return enqueueWorkerJob({
      transferId,
      file: {
        name: filename,
        size: buffer.byteLength,
      },
      route,
      originalBuffer: buffer,
    });
  }
}

async function processTransferObject(
  file: TransferUploadFileInput,
  transferId: string
) {
  const route = classifyTransferProcessingRoute(file.name);
  if (!route) {
    return processTransferObjectLocally(file, transferId);
  }

  try {
    return await processTransferObjectLocally(file, transferId, "local_done", "local", route);
  } catch {
    return enqueueWorkerJob({
      transferId,
      file,
      route,
    });
  }
}

async function repairOrQueueLegacyFile(transfer: TransferData, file: TransferFile): Promise<TransferFile> {
  const route = file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  if (!route) return file;

  try {
    return (
      await processTransferObjectLocally(
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
    ).file;
  } catch {
    return (
      await enqueueWorkerJob({
        transferId: transfer.id,
        file: {
          name: file.filename,
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

async function backfillTransferMedia(transfer: TransferData): Promise<TransferData> {
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

      if (JSON.stringify(inferred) !== JSON.stringify(file)) {
        changed = true;
      }

      if (
        compatMissing &&
        inferred.processingStatus === "failed" &&
        inferred.processingRoute
      ) {
        changed = true;
        return repairOrQueueLegacyFile(refreshed, inferred);
      }

      if (
        isTransferProcessingStale(inferred) &&
        canRetryTransferProcessing(inferred)
      ) {
        const retried = await requeueTransferFile(refreshed, inferred);
        if (JSON.stringify(retried) !== JSON.stringify(inferred)) {
          changed = true;
        }
        return retried;
      }

      return inferred;
    }
  );

  if (!changed) return refreshed;

  const updated = { ...refreshed, files };
  await saveTransfer(updated, remainingSeconds);
  return updated;
}

function createHybridMediaProcessor() {
  return {
    processTransferBuffer,
    processTransferObject,
    backfillTransferMedia,
  };
}

export { createHybridMediaProcessor };
