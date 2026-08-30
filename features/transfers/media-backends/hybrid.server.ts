import {
  getInlineProcessingTimeoutMs,
  withProcessingTimeout,
} from "@/features/transfers/media-processing-config.server";
import { mapConcurrent } from "@/features/media/processing.server";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  didTransferFileChange,
  isTransferProcessingStale,
  type ProcessingRoute,
} from "@/features/transfers/media-state";
import { saveTransfer } from "@/features/transfers/store.server";
import type { TransferData, TransferFile } from "@/features/transfers/types";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import {
  inferTransferFileState,
  listExistingTransferDerivativeKeys,
  needsStateInference,
  buildFailedLocalResult,
  processTransferBufferLocally,
  processTransferObjectLocally,
} from "./local.server";
import { enqueueWorkerJob, refreshQueuedTransferState, requeueTransferFile } from "./worker.server";

const TRANSFER_BACKFILL_CONCURRENCY = 2;

/**
 * Which routes are worth a round trip through the queue.
 *
 * RAW and video are the expensive ones: seconds of CPU, hundreds of megabytes
 * to gigabytes of source. Images and GIFs finish inline in well under a second,
 * so queueing them would only add latency and Redis traffic.
 *
 * Both spellings of each route count. Enqueueing rewrites `local_video` to
 * `worker_video` (see WORKER_ROUTE_MAP), so a file that has already been
 * through the worker carries the `worker_*` name — and recognising only the
 * pre-queue names meant a file that failed *in* the worker could never be
 * requeued by reconciliation, no matter how many retries it had left.
 */
function canUseWorkerForRoute(route: ProcessingRoute): boolean {
  return (
    route === "raw_try_local" ||
    route === "local_video" ||
    route === "worker_raw" ||
    route === "worker_video"
  );
}

/**
 * Ceiling for the work the web role still does itself. Nothing catches a file
 * that blows it — a queued route never reaches here — so it exists purely to
 * stop a wedged decode from holding a request open.
 */
function withInlineTimeout<T>(route: ProcessingRoute, work: () => Promise<T>): Promise<T> {
  return withProcessingTimeout(route, getInlineProcessingTimeoutMs(), work);
}

async function processTransferBuffer(
  buffer: Buffer,
  file: TransferUploadFileInput,
  transferId: string,
) {
  const route = classifyTransferProcessingRoute(file.name);
  if (!route) {
    return processTransferBufferLocally(buffer, file, transferId);
  }

  if (canUseWorkerForRoute(route)) {
    return enqueueWorkerJob({
      transferId,
      file: { ...file, size: buffer.byteLength },
      route,
      originalBuffer: buffer,
    });
  }

  try {
    return await withInlineTimeout(route, () =>
      processTransferBufferLocally(buffer, file, transferId, "local_done", "local", route),
    );
  } catch {
    return buildFailedLocalResult({
      transferId,
      file: { ...file, size: buffer.byteLength },
      route,
      buffer,
    });
  }
}

async function processTransferObject(file: TransferUploadFileInput, transferId: string) {
  const route = classifyTransferProcessingRoute(file.name);
  if (!route) {
    return processTransferObjectLocally(file, transferId);
  }

  if (canUseWorkerForRoute(route)) {
    return enqueueWorkerJob({ transferId, file, route });
  }

  try {
    return await withInlineTimeout(route, () =>
      processTransferObjectLocally(file, transferId, "local_done", "local", route),
    );
  } catch {
    return buildFailedLocalResult({ transferId, file, route });
  }
}

async function repairOrQueueIncompleteFile(
  transfer: TransferData,
  file: TransferFile,
): Promise<TransferFile> {
  const route = file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  if (!route) return file;

  if (canUseWorkerForRoute(route)) {
    const repaired = (
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
    return file.storedBytes === undefined
      ? repaired
      : { ...repaired, storedBytes: file.storedBytes };
  }

  try {
    const repaired = (
      await withInlineTimeout(route, () =>
        processTransferObjectLocally(
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
          route,
        ),
      )
    ).file;
    return file.storedBytes === undefined
      ? repaired
      : { ...repaired, storedBytes: file.storedBytes };
  } catch (error) {
    const detail =
      error instanceof Error
        ? (error.stack ?? error.message).slice(0, 500)
        : String(error).slice(0, 500);
    return {
      ...file,
      previewStatus: "original_only",
      processingStatus: "failed",
      processingRoute: route,
      processingErrorCode: file.processingErrorCode ?? "processing_failed",
      processingErrorDetail: detail,
    };
  }
}

async function backfillTransferMedia(transfer: TransferData): Promise<TransferData> {
  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return transfer;

  const refreshed = await refreshQueuedTransferState(transfer);
  let changed = refreshed !== transfer;
  const existingDerivativeKeys = refreshed.files.some((file) => needsStateInference(file))
    ? await listExistingTransferDerivativeKeys(refreshed.id)
    : undefined;

  const files = await mapConcurrent(
    refreshed.files,
    TRANSFER_BACKFILL_CONCURRENCY,
    async (file) => {
      const inferred = await inferTransferFileState(refreshed.id, file, existingDerivativeKeys);
      const stateIncomplete =
        !file.previewStatus ||
        !file.processingStatus ||
        (!file.processingRoute && inferred.processingStatus !== "skipped");

      if (didTransferFileChange(file, inferred)) {
        changed = true;
      }

      if (stateIncomplete && inferred.processingStatus === "failed" && inferred.processingRoute) {
        changed = true;
        return repairOrQueueIncompleteFile(refreshed, inferred);
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
    },
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
