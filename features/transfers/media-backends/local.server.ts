import path from "path";

import {
  downloadBuffer,
  downloadToFile,
  headObject,
  listObjects,
  uploadBuffer,
} from "@/lib/platform/object-storage-provider-context.server";
import {
  RawPreviewUnavailableError,
  getFileKind,
  getMimeType,
  mapConcurrent,
  processGifThumb,
  processImageVariants,
  processVideoVariants,
  processVideoVariantsFromSource,
  type ProcessedVideo,
  type ProcessedImage,
} from "@/features/media/processing.server";
import {
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  didTransferFileChange,
  getExpectedTransferAssetKeys,
  getTransferFileId,
  isTransferProcessingStale,
  type ProcessingBackend,
  type ProcessingRoute,
  type ProcessingStatus,
} from "@/features/transfers/media-state";
import { saveTransfer } from "@/features/transfers/store.server";
import type { TransferData, TransferFile } from "@/features/transfers/types";
import type { ProcessFileResult, TransferUploadFileInput } from "@/features/transfers/upload-types";
import {
  buildTransferArchivedOriginalStorageKey,
  buildTransferPrimaryStorageKey,
} from "@/features/transfers/storage";

type CompletedProcessingStatus = Extract<ProcessingStatus, "local_done" | "worker_done">;

/** Matches the hybrid backend: two decodes at a time is plenty for one box. */
const TRANSFER_BACKFILL_CONCURRENCY = 2;

function buildSkippedFile(
  filename: string,
  size: number,
  storageKey: string,
  original?: Pick<TransferUploadFileInput, "originalName" | "originalType" | "convertedFrom">,
  mimeType = getMimeType(filename),
  kind: TransferFile["kind"] = getFileKind(filename),
): TransferFile {
  return {
    id: filename,
    filename,
    kind,
    size,
    mimeType,
    storageKey,
    ...(original?.originalName ? { originalFilename: original.originalName } : {}),
    ...(original?.originalType ? { originalMimeType: original.originalType } : {}),
    ...(original?.convertedFrom ? { convertedFrom: original.convertedFrom } : {}),
    previewStatus: "original_only",
    processingStatus: "skipped",
  };
}

function getRouteKind(route: ProcessingRoute): TransferFile["kind"] {
  if (route === "local_video" || route === "worker_video") return "video";
  if (route === "local_gif" || route === "worker_gif") return "gif";
  return "image";
}

function buildReadyVisualFile(
  mediaId: string,
  filename: string,
  size: number,
  kind: TransferFile["kind"],
  mimeType: string,
  storageKey: string,
  originalStorageKey: string | undefined,
  width: number,
  height: number,
  route: ProcessingRoute,
  processingStatus: CompletedProcessingStatus,
  processingBackend: ProcessingBackend,
  takenAt?: string | null,
  livePhotoContentId?: string | null,
  original?: Pick<TransferUploadFileInput, "originalName" | "originalType" | "convertedFrom">,
  previewSource?: TransferFile["previewSource"],
): TransferFile {
  return {
    id: mediaId,
    filename,
    kind,
    size,
    mimeType,
    storageKey,
    ...(originalStorageKey ? { originalStorageKey } : {}),
    ...(original?.originalName ? { originalFilename: original.originalName } : {}),
    ...(original?.originalType ? { originalMimeType: original.originalType } : {}),
    ...(original?.convertedFrom ? { convertedFrom: original.convertedFrom } : {}),
    ...(previewSource ? { previewSource } : {}),
    width,
    height,
    ...(takenAt ? { takenAt } : {}),
    ...(livePhotoContentId ? { livePhotoContentId } : {}),
    previewStatus: "ready",
    processingStatus,
    processingBackend,
    processingRoute: route,
    processingCompletedAt: new Date().toISOString(),
  };
}

function buildOriginalOnlyFailureFile(
  mediaId: string,
  filename: string,
  size: number,
  storageKey: string,
  route: ProcessingRoute,
  code = "processing_failed",
  retryCount = 0,
): TransferFile {
  return {
    id: mediaId,
    filename,
    kind: getRouteKind(route),
    size,
    mimeType: getMimeType(filename),
    storageKey,
    previewStatus: "original_only",
    processingStatus: "failed",
    processingRoute: route,
    processingErrorCode: code,
    retryCount,
  };
}

function buildVideoFile(params: {
  derivedId: string;
  filename: string;
  storedSize: number;
  storageKey: string;
  archiveStorageKey: string | undefined;
  video: ProcessedVideo;
  route: ProcessingRoute;
  processingStatus: CompletedProcessingStatus;
  processingBackend: ProcessingBackend;
  file: TransferUploadFileInput;
}): TransferFile {
  return buildReadyVisualFile(
    params.derivedId,
    params.filename,
    params.storedSize,
    "video",
    getMimeType(params.filename),
    params.storageKey,
    params.archiveStorageKey,
    params.video.width,
    params.video.height,
    params.route,
    params.processingStatus,
    params.processingBackend,
    params.video.takenAt,
    params.video.livePhotoContentId,
    params.file,
  );
}

/**
 * Poster variants for a video whose original is already in R2.
 *
 * The bytes go object storage → temp file → ffmpeg, never through a Buffer,
 * so large clips cost disk rather than heap.
 */
async function materializeVideoFromStorage(params: {
  file: TransferUploadFileInput;
  transferId: string;
  storageKey: string;
  route: ProcessingRoute;
  processingStatus: CompletedProcessingStatus;
  processingBackend: ProcessingBackend;
}): Promise<ProcessFileResult> {
  const { file, transferId, storageKey, route, processingStatus, processingBackend } = params;
  const filename = file.name;
  const prefix = `transfers/${transferId}`;
  const derivedId = file.mediaId ?? getTransferFileId(filename);
  const archiveStorageKey = buildTransferArchivedOriginalStorageKey(transferId, file);
  const originalUploadSize = file.originalSize ?? 0;

  const video = await processVideoVariantsFromSource(
    path.extname(filename) || ".mp4",
    (destination) => downloadToFile(storageKey, destination, { scope: "private" }),
  );

  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, video.thumb.buffer, video.thumb.contentType, {
      scope: "private",
    }),
    uploadBuffer(`${prefix}/full/${derivedId}.webp`, video.full.buffer, video.full.contentType, {
      scope: "private",
    }),
  ]);

  return {
    file: buildVideoFile({
      derivedId,
      filename,
      storedSize: file.size,
      storageKey,
      archiveStorageKey,
      video,
      route,
      processingStatus,
      processingBackend,
      file,
    }),
    uploadedBytes:
      video.thumb.buffer.byteLength + video.full.buffer.byteLength + file.size + originalUploadSize,
  };
}

function preserveTransferGrouping(
  next: TransferFile,
  current?: Pick<TransferFile, "groupId" | "groupRole" | "storedBytes">,
): TransferFile {
  if (!current) return next;
  const preserved =
    next.storedBytes === undefined && current.storedBytes !== undefined
      ? { ...next, storedBytes: current.storedBytes }
      : next;
  if (!current.groupId || !current.groupRole) return preserved;
  return {
    ...preserved,
    groupId: current.groupId,
    groupRole: current.groupRole,
  };
}

async function uploadOriginalBuffer(
  storageKey: string,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  await uploadBuffer(storageKey, buffer, getMimeType(filename), { scope: "private" });
}

async function buildFailedLocalResult(params: {
  transferId: string;
  file: TransferUploadFileInput;
  route: ProcessingRoute;
  buffer?: Buffer;
  code?: string;
}): Promise<ProcessFileResult> {
  const { transferId, file, route, buffer, code = "processing_failed" } = params;
  const storageKey = buildTransferPrimaryStorageKey(transferId, file);
  const archivedStorageKey = buildTransferArchivedOriginalStorageKey(transferId, file);

  if (buffer) {
    await uploadOriginalBuffer(storageKey, file.name, buffer);
  }

  return {
    file: {
      ...buildOriginalOnlyFailureFile(
        file.mediaId ?? getTransferFileId(file.name),
        file.name,
        file.size,
        storageKey,
        route,
        code,
      ),
      ...(archivedStorageKey ? { originalStorageKey: archivedStorageKey } : {}),
      ...(file.originalName ? { originalFilename: file.originalName } : {}),
      ...(file.originalType ? { originalMimeType: file.originalType } : {}),
      ...(file.convertedFrom ? { convertedFrom: file.convertedFrom } : {}),
    },
    uploadedBytes: file.size + (file.originalSize ?? 0),
  };
}

/**
 * A RAW file we cannot preview.
 *
 * Covers both "the camera embedded no preview" and "exiftool is not installed"
 * — from the caller's side both mean the same thing, and both should leave a
 * downloadable original rather than a hard failure.
 */
function isRawPreviewUnavailableError(error: unknown): boolean {
  if (error instanceof RawPreviewUnavailableError) return true;
  return error instanceof Error && /spawn exiftool ENOENT/.test(error.message);
}

async function materializeVisualFromBuffer(params: {
  buffer: Buffer;
  file: TransferUploadFileInput;
  transferId: string;
  storageKey: string;
  storedSize: number;
  originalAlreadyStored: boolean;
  route: ProcessingRoute;
  processingStatus: CompletedProcessingStatus;
  processingBackend: ProcessingBackend;
}): Promise<ProcessFileResult> {
  const {
    buffer,
    file,
    transferId,
    storageKey,
    storedSize,
    originalAlreadyStored,
    route,
    processingStatus,
    processingBackend,
  } = params;
  const filename = file.name;
  const prefix = `transfers/${transferId}`;
  const derivedId = file.mediaId ?? getTransferFileId(filename);
  const archiveStorageKey = buildTransferArchivedOriginalStorageKey(transferId, file);
  const originalUploadSize = file.originalSize ?? 0;

  if (route === "local_gif" || route === "worker_gif") {
    const gif = await processGifThumb(buffer);
    await uploadBuffer(
      `${prefix}/thumb/${derivedId}.webp`,
      gif.thumb.buffer,
      gif.thumb.contentType,
      { scope: "private" },
    );
    if (!originalAlreadyStored && !archiveStorageKey) {
      await uploadOriginalBuffer(storageKey, filename, buffer);
    }

    return {
      file: {
        id: derivedId,
        filename,
        kind: "gif",
        size: storedSize,
        mimeType: "image/gif",
        storageKey,
        ...(archiveStorageKey ? { originalStorageKey: archiveStorageKey } : {}),
        ...(file.originalName ? { originalFilename: file.originalName } : {}),
        ...(file.originalType ? { originalMimeType: file.originalType } : {}),
        ...(file.convertedFrom ? { convertedFrom: file.convertedFrom } : {}),
        width: gif.width,
        height: gif.height,
        previewStatus: "ready",
        processingStatus,
        processingBackend,
        processingRoute: route,
        processingCompletedAt: new Date().toISOString(),
      },
      uploadedBytes: gif.thumb.buffer.byteLength + storedSize + originalUploadSize,
    };
  }

  if (route === "local_video" || route === "worker_video") {
    const video = await processVideoVariants(buffer, filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${derivedId}.webp`,
        video.thumb.buffer,
        video.thumb.contentType,
        { scope: "private" },
      ),
      uploadBuffer(`${prefix}/full/${derivedId}.webp`, video.full.buffer, video.full.contentType, {
        scope: "private",
      }),
      originalAlreadyStored || archiveStorageKey
        ? Promise.resolve()
        : uploadOriginalBuffer(storageKey, filename, buffer),
    ]);

    return {
      file: buildVideoFile({
        derivedId,
        filename,
        storedSize,
        storageKey,
        archiveStorageKey,
        video,
        route,
        processingStatus,
        processingBackend,
        file,
      }),
      uploadedBytes:
        video.thumb.buffer.byteLength +
        video.full.buffer.byteLength +
        storedSize +
        originalUploadSize,
    };
  }

  try {
    const processed: ProcessedImage = await processImageVariants(buffer, filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${derivedId}.webp`,
        processed.thumb.buffer,
        processed.thumb.contentType,
        { scope: "private" },
      ),
      uploadBuffer(
        `${prefix}/full/${derivedId}.webp`,
        processed.full.buffer,
        processed.full.contentType,
        { scope: "private" },
      ),
      originalAlreadyStored || archiveStorageKey
        ? Promise.resolve()
        : uploadOriginalBuffer(storageKey, filename, buffer),
    ]);

    return {
      file: buildReadyVisualFile(
        derivedId,
        filename,
        storedSize,
        "image",
        getMimeType(filename),
        storageKey,
        archiveStorageKey,
        processed.width,
        processed.height,
        route,
        processingStatus,
        processingBackend,
        processed.takenAt,
        processed.livePhotoContentId,
        file,
      ),
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        storedSize +
        originalUploadSize,
    };
  } catch (error) {
    // No second attempt for RAW: the only decoder is the camera's embedded
    // preview, so `raw_preview_unavailable` means the file genuinely has none.
    // Retrying would re-run the same exiftool call for the same answer.
    if (!isRawPreviewUnavailableError(error)) {
      throw error;
    }

    if (!originalAlreadyStored && !archiveStorageKey) {
      await uploadOriginalBuffer(storageKey, filename, buffer);
    }

    return {
      file: {
        ...buildOriginalOnlyFailureFile(
          derivedId,
          filename,
          storedSize,
          storageKey,
          route,
          "raw_preview_unavailable",
        ),
        ...(archiveStorageKey ? { originalStorageKey: archiveStorageKey } : {}),
        ...(file.originalName ? { originalFilename: file.originalName } : {}),
        ...(file.originalType ? { originalMimeType: file.originalType } : {}),
        ...(file.convertedFrom ? { convertedFrom: file.convertedFrom } : {}),
      },
      uploadedBytes: storedSize + originalUploadSize,
    };
  }
}

async function processTransferBufferLocally(
  buffer: Buffer,
  input: TransferUploadFileInput | string,
  transferId: string,
  processingStatus: CompletedProcessingStatus = "local_done",
  processingBackend: ProcessingBackend = "local",
  explicitRoute?: ProcessingRoute | null,
): Promise<ProcessFileResult> {
  const file =
    typeof input === "string"
      ? { name: input, size: buffer.byteLength, type: getMimeType(input) }
      : { ...input, size: buffer.byteLength };
  const filename = file.name;
  const route = explicitRoute ?? classifyTransferProcessingRoute(filename);
  const storageKey = buildTransferPrimaryStorageKey(transferId, file);
  if (!route) {
    await uploadOriginalBuffer(storageKey, filename, buffer);
    return {
      file: buildSkippedFile(filename, buffer.byteLength, storageKey),
      uploadedBytes: buffer.byteLength,
    };
  }

  return materializeVisualFromBuffer({
    buffer,
    file,
    transferId,
    storageKey,
    storedSize: buffer.byteLength,
    originalAlreadyStored: false,
    route,
    processingStatus,
    processingBackend,
  });
}

async function processTransferObjectLocally(
  file: TransferUploadFileInput,
  transferId: string,
  processingStatus: CompletedProcessingStatus = "local_done",
  processingBackend: ProcessingBackend = "local",
  explicitRoute?: ProcessingRoute | null,
): Promise<ProcessFileResult> {
  const route = explicitRoute ?? classifyTransferProcessingRoute(file.name);
  const storageKey = buildTransferPrimaryStorageKey(transferId, file);
  if (!route) {
    return {
      file: buildSkippedFile(file.name, file.size, storageKey, file),
      uploadedBytes: file.size + (file.originalSize ?? 0),
    };
  }

  // Videos stream to disk; everything else is small enough to hold in memory.
  if (route === "local_video" || route === "worker_video") {
    return materializeVideoFromStorage({
      file,
      transferId,
      storageKey,
      route,
      processingStatus,
      processingBackend,
    });
  }

  const buffer = await downloadBuffer(storageKey, { scope: "private" });
  return materializeVisualFromBuffer({
    buffer,
    file,
    transferId,
    storageKey,
    storedSize: file.size,
    originalAlreadyStored: true,
    route,
    processingStatus,
    processingBackend,
  });
}

async function inferTransferFileState(
  transferId: string,
  file: TransferFile,
  existingDerivativeKeys?: Set<string>,
): Promise<TransferFile> {
  const inferredRoute = classifyTransferProcessingRoute(file.filename);
  if (!needsStateInference(file)) {
    return file;
  }

  const route = inferredRoute;
  if (!route) {
    return {
      ...file,
      storageKey:
        file.storageKey ?? buildTransferPrimaryStorageKey(transferId, { name: file.filename }),
      previewStatus: "original_only",
      processingStatus: "skipped",
    };
  }

  const expected = getExpectedTransferAssetKeys(transferId, file.filename, route, file.id);
  const [thumbExists, fullExists] = existingDerivativeKeys
    ? [
        expected.thumbKey ? existingDerivativeKeys.has(expected.thumbKey) : true,
        expected.fullKey ? existingDerivativeKeys.has(expected.fullKey) : true,
      ]
    : await Promise.all([
        expected.thumbKey
          ? headObject(expected.thumbKey, { scope: "private" }).then((meta) => meta.exists)
          : Promise.resolve(true),
        expected.fullKey
          ? headObject(expected.fullKey, { scope: "private" }).then((meta) => meta.exists)
          : Promise.resolve(true),
      ]);

  if (thumbExists && fullExists) {
    return {
      ...file,
      storageKey:
        file.storageKey ?? buildTransferPrimaryStorageKey(transferId, { name: file.filename }),
      previewStatus: "ready",
      processingStatus: "local_done",
      processingBackend: "local",
      processingRoute: route,
    };
  }

  return {
    ...file,
    ...buildOriginalOnlyFailureFile(
      file.id,
      file.filename,
      file.size,
      file.storageKey ?? buildTransferPrimaryStorageKey(transferId, { name: file.filename }),
      route,
      "missing_derivatives",
    ),
  };
}

function needsStateInference(file: TransferFile): boolean {
  // Releases before poster extraction became fully streaming permanently
  // skipped large videos. Re-infer them so reconciliation can enqueue the
  // missing derivatives without an operator finding each transfer.
  if (file.processingErrorCode === "video_too_large_for_poster") return true;
  const inferredRoute = classifyTransferProcessingRoute(file.filename);
  if (file.previewStatus && file.processingStatus) {
    if (file.processingRoute) return false;
    if (file.processingStatus === "skipped" && !inferredRoute) return false;
  }
  return true;
}

async function listExistingTransferDerivativeKeys(transferId: string): Promise<Set<string>> {
  const [thumbObjects, fullObjects] = await Promise.all([
    listObjects(`transfers/${transferId}/thumb/`, { scope: "private" }),
    listObjects(`transfers/${transferId}/full/`, { scope: "private" }),
  ]);
  return new Set([...thumbObjects, ...fullObjects].map((object) => object.key));
}

function markRetriesExhausted(file: TransferFile): TransferFile {
  return {
    ...file,
    previewStatus: "original_only",
    processingStatus: "failed",
    processingErrorCode: "retries_exhausted",
  };
}

async function retryLocalTransferFile(
  transfer: TransferData,
  file: TransferFile,
): Promise<TransferFile> {
  const route = file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  if (!route) return file;

  const retryCount = (file.retryCount ?? 0) + 1;

  try {
    return (
      await processTransferObjectLocally(
        {
          name: file.filename,
          mediaId: file.id,
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
      )
    ).file;
  } catch (error) {
    const failed = await buildFailedLocalResult({
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
      code: isRawPreviewUnavailableError(error) ? "raw_preview_unavailable" : "processing_failed",
    });
    return {
      ...preserveTransferGrouping(failed.file, file),
      retryCount,
    };
  }
}

function createLocalMediaProcessor() {
  return {
    processTransferBuffer: async (
      buffer: Buffer,
      file: TransferUploadFileInput,
      transferId: string,
    ) => {
      const route = classifyTransferProcessingRoute(file.name);
      try {
        return await processTransferBufferLocally(
          buffer,
          { ...file, size: buffer.byteLength },
          transferId,
          "local_done",
          "local",
          route,
        );
      } catch (error) {
        return buildFailedLocalResult({
          transferId,
          file: { ...file, size: buffer.byteLength },
          route: route ?? "local_image",
          buffer,
          code: isRawPreviewUnavailableError(error)
            ? "raw_preview_unavailable"
            : "processing_failed",
        });
      }
    },
    processTransferObject: async (file: TransferUploadFileInput, transferId: string) => {
      const route = classifyTransferProcessingRoute(file.name);
      try {
        return await processTransferObjectLocally(file, transferId, "local_done", "local", route);
      } catch (error) {
        return buildFailedLocalResult({
          transferId,
          file,
          route: route ?? "local_image",
          code: isRawPreviewUnavailableError(error)
            ? "raw_preview_unavailable"
            : "processing_failed",
        });
      }
    },
    backfillTransferMedia: async (transfer: TransferData) => {
      const remainingSeconds = Math.ceil(
        (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000,
      );
      if (remainingSeconds <= 0) return transfer;

      let changed = false;
      const nowMs = Date.now();
      const existingDerivativeKeys = transfer.files.some((file) => needsStateInference(file))
        ? await listExistingTransferDerivativeKeys(transfer.id)
        : undefined;
      // Bounded, not `Promise.all`: each retry downloads an original and runs a
      // decoder, so a 200-file transfer would otherwise start 200 at once.
      const normalizedFiles = await mapConcurrent(
        transfer.files,
        TRANSFER_BACKFILL_CONCURRENCY,
        async (file) => {
          const inferred = await inferTransferFileState(transfer.id, file, existingDerivativeKeys);
          if (didTransferFileChange(file, inferred)) {
            changed = true;
          }

          if (
            inferred.processingStatus === "failed" &&
            inferred.processingRoute &&
            canRetryTransferProcessing(inferred)
          ) {
            const retried = await retryLocalTransferFile(transfer, inferred);
            if (didTransferFileChange(inferred, retried)) {
              changed = true;
            }
            return preserveTransferGrouping(retried, inferred);
          }

          if (isTransferProcessingStale(inferred, nowMs) && canRetryTransferProcessing(inferred)) {
            const retried = await retryLocalTransferFile(transfer, inferred);
            if (didTransferFileChange(inferred, retried)) {
              changed = true;
            }
            return preserveTransferGrouping(retried, inferred);
          }

          if (isTransferProcessingStale(inferred, nowMs) && !canRetryTransferProcessing(inferred)) {
            const exhausted = markRetriesExhausted(inferred);
            if (didTransferFileChange(inferred, exhausted)) {
              changed = true;
            }
            return exhausted;
          }

          return inferred;
        },
      );

      if (!changed) {
        return transfer;
      }

      const updated: TransferData = {
        ...transfer,
        files: normalizedFiles,
      };

      await saveTransfer(updated, remainingSeconds);
      return updated;
    },
  };
}

export {
  buildOriginalOnlyFailureFile,
  buildReadyVisualFile,
  buildFailedLocalResult,
  buildSkippedFile,
  createLocalMediaProcessor,
  getRouteKind,
  inferTransferFileState,
  listExistingTransferDerivativeKeys,
  needsStateInference,
  processTransferBufferLocally,
  processTransferObjectLocally,
};
