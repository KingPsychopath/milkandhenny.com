import "server-only";

import { getMimeType } from "@/features/media/processing";
import { uploadBuffer } from "@/lib/platform/r2";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  getExpectedTransferAssetKeys,
  getTransferFileId,
  isTransferProcessingStale,
  type ProcessingRoute,
} from "@/features/transfers/media-state";
import {
  dequeueTransferMediaJobs,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
  type TransferMediaJob,
} from "@/features/transfers/media-queue";
import { getTransfer, saveTransfer, type TransferData, type TransferFile } from "@/features/transfers/store";
import type { ProcessFileResult } from "@/features/transfers/upload-types";
import {
  buildOriginalOnlyFailureFile,
  getRouteKind,
  processTransferObjectLocally,
} from "@/features/media/backends/local";

type WorkerRunResult = {
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
  queueLength: number;
};

function buildQueuedTransferFile(
  filename: string,
  size: number,
  route: ProcessingRoute,
  attempt: number
): TransferFile {
  return {
    id: getTransferFileId(filename),
    filename,
    kind: getRouteKind(route),
    size,
    mimeType: getMimeType(filename),
    previewStatus: "original_only",
    processingStatus: "queued",
    processingBackend: "worker",
    processingRoute: route,
    enqueuedAt: new Date().toISOString(),
    retryCount: Math.max(0, attempt - 1),
  };
}

function buildFailedQueueResult(
  filename: string,
  size: number,
  route: ProcessingRoute,
  code: string,
  attempt: number
): ProcessFileResult {
  return {
    file: {
      ...buildOriginalOnlyFailureFile(filename, size, route, code, Math.max(0, attempt - 1)),
      processingBackend: "worker",
    },
    uploadedBytes: size,
  };
}

async function enqueueWorkerJob(params: {
  transferId: string;
  filename: string;
  size: number;
  route: ProcessingRoute;
  attempt?: number;
  originalBuffer?: Buffer;
}): Promise<ProcessFileResult> {
  const attempt = params.attempt ?? 1;
  const route = params.route === "raw_try_local" ? "worker_raw" : params.route;
  const mimeType = getMimeType(params.filename);

  if (params.originalBuffer) {
    await uploadBuffer(
      `transfers/${params.transferId}/original/${params.filename}`,
      params.originalBuffer,
      mimeType
    );
  }

  const expected = getExpectedTransferAssetKeys(params.transferId, params.filename, route);
  const enqueuedAt = new Date().toISOString();

  try {
    await enqueueTransferMediaJob({
      transferId: params.transferId,
      filename: params.filename,
      originalKey: `transfers/${params.transferId}/original/${params.filename}`,
      expectedThumbKey: expected.thumbKey,
      expectedFullKey: expected.fullKey,
      mimeType,
      processingRoute: route,
      attempt,
      enqueuedAt,
    });

    return {
      file: {
        ...buildQueuedTransferFile(params.filename, params.size, route, attempt),
        mimeType,
        enqueuedAt,
      },
      uploadedBytes: params.size,
    };
  } catch {
    return buildFailedQueueResult(params.filename, params.size, route, "enqueue_failed", attempt);
  }
}

async function processWorkerJob(job: TransferMediaJob): Promise<"succeeded" | "failed" | "skipped"> {
  const transfer = await getTransfer(job.transferId);
  if (!transfer) return "skipped";

  const fileIndex = transfer.files.findIndex((file) => file.filename === job.filename);
  if (fileIndex === -1) return "skipped";
  const current = transfer.files[fileIndex];
  if (current.processingStatus === "local_done" || current.processingStatus === "worker_done") {
    return "skipped";
  }

  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return "skipped";

  const processingFile: TransferFile = {
    ...current,
    processingStatus: "processing",
    processingBackend: "worker",
    processingRoute: job.processingRoute,
    processingStartedAt: new Date().toISOString(),
  };
  const processingTransfer: TransferData = {
    ...transfer,
    files: transfer.files.map((file, index) => (index === fileIndex ? processingFile : file)),
  };
  await saveTransfer(processingTransfer, remainingSeconds);

  try {
    const result = await processTransferObjectLocally(
      job.filename,
      current.size,
      job.transferId,
      "worker_done",
      "worker",
      job.processingRoute
    );
    const updated: TransferData = {
      ...processingTransfer,
      files: processingTransfer.files.map((file, index) =>
        index === fileIndex ? result.file : file
      ),
    };
    await saveTransfer(updated, remainingSeconds);
    return "succeeded";
  } catch {
    const failed: TransferData = {
      ...processingTransfer,
      files: processingTransfer.files.map((file, index) =>
        index === fileIndex
          ? {
              ...buildOriginalOnlyFailureFile(job.filename, current.size, job.processingRoute, "worker_failed", job.attempt),
              processingBackend: "worker",
            }
          : file
      ),
    };
    await saveTransfer(failed, remainingSeconds);
    return "failed";
  }
}

async function runTransferMediaJobs(limit = 8): Promise<WorkerRunResult> {
  const jobs = await dequeueTransferMediaJobs(limit);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const outcome = await processWorkerJob(job);
    if (outcome === "succeeded") succeeded += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return {
    processedJobs: jobs.length,
    succeeded,
    failed,
    skipped,
    queueLength: await getTransferMediaQueueLength(),
  };
}

async function requeueTransferFile(
  transfer: TransferData,
  file: TransferFile,
  force = false
): Promise<TransferFile> {
  const route = file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  if (!route) return file;
  if (
    !force &&
    (file.processingStatus === "queued" ||
      file.processingStatus === "processing" ||
      file.processingStatus === "worker_done" ||
      file.processingStatus === "local_done")
  ) {
    return file;
  }
  if (!canRetryTransferProcessing(file, force)) {
    return file;
  }

  const attempt = (file.retryCount ?? 0) + 1;
  const result = await enqueueWorkerJob({
    transferId: transfer.id,
    filename: file.filename,
    size: file.size,
    route,
    attempt,
  });
  return result.file;
}

async function refreshQueuedTransferState(transfer: TransferData): Promise<TransferData> {
  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return transfer;

  let changed = false;
  const nowMs = Date.now();
  const files = await Promise.all(
    transfer.files.map(async (file) => {
      if (!isTransferProcessingStale(file, nowMs)) return file;
      if (!canRetryTransferProcessing(file)) return file;
      const retried = await requeueTransferFile(transfer, file, true);
      if (JSON.stringify(retried) !== JSON.stringify(file)) changed = true;
      return retried;
    })
  );

  if (!changed) return transfer;

  const updated = { ...transfer, files };
  await saveTransfer(updated, remainingSeconds);
  return updated;
}

export {
  buildQueuedTransferFile,
  enqueueWorkerJob,
  getTransferMediaQueueLength,
  refreshQueuedTransferState,
  requeueTransferFile,
  runTransferMediaJobs,
};

export type { WorkerRunResult };
