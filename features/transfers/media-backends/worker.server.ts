import path from "path";

import {
  getMimeType,
  mapConcurrent,
  processImageVariants,
  RawPreviewUnavailableError,
  resolveImageProcessingSource,
} from "@/features/media/processing.server";
import { downloadBuffer, uploadBuffer } from "@/lib/platform/r2.server";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  didTransferFileChange,
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
} from "@/features/transfers/media-queue.server";
import { getTransfer, updateTransferFile } from "@/features/transfers/store.server";
import { publishTransferMediaEvent } from "@/features/transfers/media-events.server";
import {
  getWorkerProcessingTimeoutMs,
  withProcessingTimeout,
} from "@/features/transfers/media-processing-config.server";
import type { TransferData, TransferFile } from "@/features/transfers/types";
import type { ProcessFileResult, TransferUploadFileInput } from "@/features/transfers/upload-types";
import {
  buildTransferArchivedOriginalStorageKey,
  buildTransferPrimaryStorageKey,
} from "@/features/transfers/storage";
import {
  buildOriginalOnlyFailureFile,
  buildReadyVisualFile,
  getRouteKind,
  processTransferObjectLocally,
} from "@/features/transfers/media-backends/local.server";

type WorkerRunResult = {
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
  queueLength: number;
};

const WORKER_JOB_CONCURRENCY = Math.max(1, Number(process.env.MEDIA_WORKER_CONCURRENCY ?? "1"));

const WORKER_ROUTE_MAP: Partial<Record<ProcessingRoute, ProcessingRoute>> = {
  raw_try_local: "worker_raw",
  local_image: "worker_image",
  local_gif: "worker_gif",
  local_video: "worker_video",
};

/**
 * Persist a file's new state and tell anyone watching the transfer.
 *
 * Every worker-side state change goes through here so a viewer sees queued →
 * processing → ready without touching the server.
 */
async function saveAndAnnounceTransferFile(transferId: string, file: TransferFile): Promise<void> {
  await updateTransferFile(transferId, file);
  await publishTransferMediaEvent(transferId, file);
}

/**
 * Distinguish "this RAW cannot be previewed" from a genuine processing bug, so
 * the file is reported as a downloadable original rather than a failure.
 */
function isRawPreviewFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const detail = `${error.message}\n${error.stack ?? ""}`;
  return detail.includes("spawn exiftool ENOENT") || detail.includes("Sharp could not decode");
}

function buildQueuedTransferFile(
  mediaId: string,
  filename: string,
  size: number,
  storageKey: string,
  route: ProcessingRoute,
  attempt: number,
): TransferFile {
  return {
    id: mediaId,
    filename,
    kind: getRouteKind(route),
    size,
    mimeType: getMimeType(filename),
    storageKey,
    previewStatus: "original_only",
    processingStatus: "queued",
    processingBackend: "worker",
    processingRoute: route,
    enqueuedAt: new Date().toISOString(),
    retryCount: Math.max(0, attempt - 1),
  };
}

function buildFailedQueueResult(
  mediaId: string,
  filename: string,
  size: number,
  storageKey: string,
  route: ProcessingRoute,
  code: string,
  attempt: number,
): ProcessFileResult {
  return {
    file: {
      ...buildOriginalOnlyFailureFile(
        mediaId,
        filename,
        size,
        storageKey,
        route,
        code,
        Math.max(0, attempt - 1),
      ),
      processingBackend: "worker",
    },
    uploadedBytes: size,
  };
}

async function enqueueWorkerJob(params: {
  transferId: string;
  file: TransferUploadFileInput;
  route: ProcessingRoute;
  attempt?: number;
  originalBuffer?: Buffer;
}): Promise<ProcessFileResult> {
  const attempt = params.attempt ?? 1;
  const route = WORKER_ROUTE_MAP[params.route] ?? params.route;
  const mimeType = getMimeType(params.file.name);
  const storageKey = buildTransferPrimaryStorageKey(params.transferId, params.file);
  const mediaId = params.file.mediaId ?? getTransferFileId(params.file.name);

  if (params.originalBuffer) {
    await uploadBuffer(storageKey, params.originalBuffer, mimeType, { scope: "private" });
  }

  const expected = getExpectedTransferAssetKeys(
    params.transferId,
    params.file.name,
    route,
    mediaId,
  );
  const enqueuedAt = new Date().toISOString();

  try {
    await enqueueTransferMediaJob({
      transferId: params.transferId,
      file: params.file,
      mediaId,
      storageKey,
      expectedThumbKey: expected.thumbKey,
      expectedFullKey: expected.fullKey,
      mimeType,
      processingRoute: route,
      attempt,
      enqueuedAt,
    });
    return {
      file: {
        ...buildQueuedTransferFile(
          mediaId,
          params.file.name,
          params.file.size,
          storageKey,
          route,
          attempt,
        ),
        mimeType,
        ...(params.file.originalName ? { originalFilename: params.file.originalName } : {}),
        ...(params.file.originalType ? { originalMimeType: params.file.originalType } : {}),
        ...(params.file.convertedFrom ? { convertedFrom: params.file.convertedFrom } : {}),
        ...(buildTransferArchivedOriginalStorageKey(params.transferId, params.file)
          ? {
              originalStorageKey: buildTransferArchivedOriginalStorageKey(
                params.transferId,
                params.file,
              ),
            }
          : {}),
        enqueuedAt,
      },
      uploadedBytes: params.file.size + (params.file.originalSize ?? 0),
    };
  } catch {
    return buildFailedQueueResult(
      mediaId,
      params.file.name,
      params.file.size,
      storageKey,
      route,
      "enqueue_failed",
      attempt,
    );
  }
}

async function processWorkerJob(
  job: TransferMediaJob,
): Promise<"succeeded" | "failed" | "skipped"> {
  const transfer = await getTransfer(job.transferId);
  if (!transfer) return "skipped";

  const mediaId = job.mediaId ?? job.file.mediaId ?? getTransferFileId(job.file.name);
  const fileIndex = transfer.files.findIndex((file) => file.id === mediaId);
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
  await saveAndAnnounceTransferFile(job.transferId, processingFile);

  try {
    // A wedged decode must fail the job rather than hold the only worker slot.
    // The error lands in the catch below, which records it and acks — retrying
    // a job that already blew its budget would just wedge the next slot too.
    const result = await withProcessingTimeout(
      `${job.processingRoute} ${mediaId}`,
      getWorkerProcessingTimeoutMs(),
      async (): Promise<ProcessFileResult> => {
        if (job.processingRoute === "worker_raw") {
          const original = await downloadBuffer(current.storageKey, { scope: "private" });
          const filename = job.file.originalName ?? job.file.name;
          const ext = path.extname(filename).toLowerCase() || ".dng";

          const { buffer: source, takenAt } = await resolveImageProcessingSource(original, ext);

          const processed = await processImageVariants(source, ".jpg");

          const prefix = `transfers/${job.transferId}`;
          await Promise.all([
            uploadBuffer(
              `${prefix}/thumb/${mediaId}.webp`,
              processed.thumb.buffer,
              processed.thumb.contentType,
              { scope: "private" },
            ),
            uploadBuffer(
              `${prefix}/full/${mediaId}.webp`,
              processed.full.buffer,
              processed.full.contentType,
              { scope: "private" },
            ),
          ]);

          return {
            file: buildReadyVisualFile(
              mediaId,
              job.file.name,
              current.size,
              "image",
              current.mimeType,
              current.storageKey,
              current.originalStorageKey,
              processed.width,
              processed.height,
              job.processingRoute,
              "worker_done",
              "worker",
              processed.takenAt ?? takenAt ?? current.takenAt ?? null,
              processed.livePhotoContentId ?? current.livePhotoContentId ?? null,
              job.file,
              "server_raw",
            ),
            uploadedBytes:
              processed.thumb.buffer.byteLength + processed.full.buffer.byteLength + current.size,
          };
        }

        return processTransferObjectLocally(
          {
            ...job.file,
            size: current.size,
          },
          job.transferId,
          "worker_done",
          "worker",
          job.processingRoute,
        );
      },
    );

    const updatedFile: TransferFile = {
      ...result.file,
      ...(current.groupId ? { groupId: current.groupId } : {}),
      ...(current.groupRole ? { groupRole: current.groupRole } : {}),
    };
    await saveAndAnnounceTransferFile(job.transferId, updatedFile);
    return "succeeded";
  } catch (error) {
    const errorDetail =
      error instanceof Error
        ? (error.stack ?? error.message).slice(0, 500)
        : String(error).slice(0, 500);
    const failureCode =
      job.processingRoute === "worker_raw" &&
      (error instanceof RawPreviewUnavailableError || isRawPreviewFallbackError(error))
        ? "raw_preview_unavailable"
        : "worker_failed";
    console.error(
      `[transfer-media-worker] job failed transfer=${job.transferId} mediaId=${mediaId} route=${job.processingRoute}\n${errorDetail}`,
    );
    const failedFile: TransferFile = {
      ...buildOriginalOnlyFailureFile(
        mediaId,
        job.file.name,
        current.size,
        current.storageKey,
        job.processingRoute,
        failureCode,
        job.attempt,
      ),
      processingBackend: "worker",
      storageKey: current.storageKey,
      ...(current.originalStorageKey ? { originalStorageKey: current.originalStorageKey } : {}),
      ...(current.originalFilename ? { originalFilename: current.originalFilename } : {}),
      ...(current.originalMimeType ? { originalMimeType: current.originalMimeType } : {}),
      ...(current.convertedFrom ? { convertedFrom: current.convertedFrom } : {}),
      ...(current.groupId ? { groupId: current.groupId } : {}),
      ...(current.groupRole ? { groupRole: current.groupRole } : {}),
      processingErrorDetail: errorDetail,
    };
    await saveAndAnnounceTransferFile(job.transferId, failedFile);
    return "failed";
  }
}

async function runTransferMediaJobs(limit = 8): Promise<WorkerRunResult> {
  const jobs = await dequeueTransferMediaJobs(limit);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  const outcomes = await mapConcurrent(
    jobs,
    Math.min(WORKER_JOB_CONCURRENCY, Math.max(1, jobs.length)),
    (job) => processWorkerJob(job),
  );

  for (const outcome of outcomes) {
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
  force = false,
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
    file: {
      name: file.filename,
      mediaId: file.id,
      size: file.size,
      type: file.mimeType,
      originalName: file.originalFilename,
      originalType: file.originalMimeType,
      convertedFrom: file.convertedFrom,
    },
    route,
    attempt,
  });
  return result.file;
}

/**
 * Requeue files that are already finished.
 *
 * Reconciliation deliberately leaves `ready` files alone — nothing is wrong
 * with them. But when the pipeline itself learns something new (a metadata
 * field we did not used to read, a decode bug fixed), their derivatives are
 * stale in a way no amount of state inspection can detect. This is the operator
 * path for that: an explicit "do it again" for a chosen set.
 */
async function forceReprocessTransferFiles(
  transfer: TransferData,
  match: (file: TransferFile) => boolean,
): Promise<{ requeued: string[]; skipped: string[] }> {
  const requeued: string[] = [];
  const skipped: string[] = [];

  for (const file of transfer.files) {
    if (!match(file)) continue;

    const next = await requeueTransferFile(transfer, file, true);
    if (next.processingStatus === "queued") {
      await saveAndAnnounceTransferFile(transfer.id, next);
      requeued.push(file.id);
    } else {
      // No worker route — an audio file or a plain document has no derivative
      // to rebuild.
      skipped.push(file.id);
    }
  }

  return { requeued, skipped };
}

async function refreshQueuedTransferState(transfer: TransferData): Promise<TransferData> {
  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return transfer;

  let changed = false;
  const nowMs = Date.now();
  const files = await Promise.all(
    transfer.files.map(async (file) => {
      if (!isTransferProcessingStale(file, nowMs)) return file;
      if (!canRetryTransferProcessing(file)) {
        const exhausted: TransferFile = {
          ...file,
          previewStatus: "original_only",
          processingStatus: "failed",
          processingErrorCode: "retries_exhausted",
        };
        if (didTransferFileChange(file, exhausted)) changed = true;
        return exhausted;
      }
      const retried = await requeueTransferFile(transfer, file, true);
      if (didTransferFileChange(file, retried)) changed = true;
      return retried;
    }),
  );

  if (!changed) return transfer;

  const originalFilesById = new Map(transfer.files.map((file) => [file.id, file]));
  for (const file of files) {
    const original = originalFilesById.get(file.id);
    if (original && didTransferFileChange(original, file)) {
      await updateTransferFile(transfer.id, file);
    }
  }
  return { ...transfer, files };
}

export {
  buildQueuedTransferFile,
  enqueueWorkerJob,
  forceReprocessTransferFiles,
  getTransferMediaQueueLength,
  processWorkerJob,
  refreshQueuedTransferState,
  requeueTransferFile,
  runTransferMediaJobs,
};

export type { WorkerRunResult };
