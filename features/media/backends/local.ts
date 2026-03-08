import "server-only";

import { downloadBuffer, headObject, uploadBuffer } from "@/lib/platform/r2";
import {
  RawPreviewUnavailableError,
  getFileKind,
  getMimeType,
  processGifThumb,
  processImageVariants,
  processRawWithDcraw,
  processVideoVariants,
  type ProcessedImage,
} from "@/features/media/processing";
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
import { saveTransfer, type TransferData, type TransferFile } from "@/features/transfers/store";
import type { ProcessFileResult, TransferUploadFileInput } from "@/features/transfers/upload-types";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "@/features/transfers/storage";

type CompletedProcessingStatus = Extract<ProcessingStatus, "local_done" | "worker_done">;

function buildSkippedFile(
  filename: string,
  size: number,
  storageKey: string,
  original?: Pick<TransferUploadFileInput, "originalName" | "originalType" | "convertedFrom">,
  mimeType = getMimeType(filename),
  kind: TransferFile["kind"] = getFileKind(filename)
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
  previewSource?: TransferFile["previewSource"]
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
  retryCount = 0
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

function preserveTransferGrouping(
  next: TransferFile,
  current?: Pick<TransferFile, "groupId" | "groupRole">
): TransferFile {
  if (!current?.groupId || !current.groupRole) return next;
  return {
    ...next,
    groupId: current.groupId,
    groupRole: current.groupRole,
  };
}

async function uploadOriginalBuffer(
  storageKey: string,
  filename: string,
  buffer: Buffer
): Promise<void> {
  await uploadBuffer(storageKey, buffer, getMimeType(filename));
}

async function buildFailedLocalResult(
  params: {
    transferId: string;
    file: TransferUploadFileInput;
    route: ProcessingRoute;
    buffer?: Buffer;
    code?: string;
  }
): Promise<ProcessFileResult> {
  const { transferId, file, route, buffer, code = "processing_failed" } = params;
  const storageKey = buildTransferPrimaryStorageKey(transferId, file);
  const archivedStorageKey = buildTransferArchivedOriginalStorageKey(transferId, file);

  if (buffer) {
    await uploadOriginalBuffer(storageKey, file.name, buffer);
  }

  return {
    file: {
      ...buildOriginalOnlyFailureFile(file.mediaId ?? getTransferFileId(file.name), file.name, file.size, storageKey, route, code),
      ...(archivedStorageKey ? { originalStorageKey: archivedStorageKey } : {}),
      ...(file.originalName ? { originalFilename: file.originalName } : {}),
      ...(file.originalType ? { originalMimeType: file.originalType } : {}),
      ...(file.convertedFrom ? { convertedFrom: file.convertedFrom } : {}),
    },
    uploadedBytes: file.size + (file.originalSize ?? 0),
  };
}

function isRawPreviewUnavailableError(error: unknown): error is RawPreviewUnavailableError {
  return error instanceof RawPreviewUnavailableError;
}

function getProcessedImageLongestEdge(image: Pick<ProcessedImage, "width" | "height">): number {
  return Math.max(image.width, image.height);
}

async function processRawWithLocalDecode(
  raw: Buffer,
  sourceName: string
): Promise<ProcessedImage> {
  const decoded = await processRawWithDcraw(raw, sourceName);
  return processImageVariants(decoded.buffer, ".jpg");
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
    await uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, gif.thumb.buffer, gif.thumb.contentType);
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
      uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, video.thumb.buffer, video.thumb.contentType),
      uploadBuffer(`${prefix}/full/${derivedId}.webp`, video.full.buffer, video.full.contentType),
      originalAlreadyStored || archiveStorageKey ? Promise.resolve() : uploadOriginalBuffer(storageKey, filename, buffer),
    ]);

    return {
        file: buildReadyVisualFile(
          derivedId,
          filename,
        storedSize,
        "video",
        getMimeType(filename),
        storageKey,
        archiveStorageKey,
        video.width,
        video.height,
        route,
        processingStatus,
        processingBackend,
        undefined,
        undefined,
        file
      ),
      uploadedBytes:
        video.thumb.buffer.byteLength +
        video.full.buffer.byteLength +
        storedSize +
        originalUploadSize,
    };
  }

  try {
    let primaryProcessed: ProcessedImage | null = null;
    let primaryError: unknown;
    try {
      primaryProcessed = await processImageVariants(buffer, filename);
    } catch (error) {
      primaryError = error;
    }

    const processed = primaryProcessed;
    if (!processed) {
      throw primaryError;
    }

    await Promise.all([
      uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, processed.thumb.buffer, processed.thumb.contentType),
      uploadBuffer(`${prefix}/full/${derivedId}.webp`, processed.full.buffer, processed.full.contentType),
      originalAlreadyStored || archiveStorageKey ? Promise.resolve() : uploadOriginalBuffer(storageKey, filename, buffer),
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
        file
      ),
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        storedSize +
        originalUploadSize,
    };
  } catch (error) {
    if (isRawPreviewUnavailableError(error) && route === "raw_try_local") {
      try {
        const processed = await processRawWithLocalDecode(buffer, filename);

        await Promise.all([
          uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, processed.thumb.buffer, processed.thumb.contentType),
          uploadBuffer(`${prefix}/full/${derivedId}.webp`, processed.full.buffer, processed.full.contentType),
          originalAlreadyStored || archiveStorageKey ? Promise.resolve() : uploadOriginalBuffer(storageKey, filename, buffer),
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
            "server_raw"
          ),
          uploadedBytes:
            processed.thumb.buffer.byteLength +
            processed.full.buffer.byteLength +
            storedSize +
            originalUploadSize,
        };
      } catch {
        // If local RAW decoding is unavailable, preserve original-only behavior.
      }
    }

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
          "raw_preview_unavailable"
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
  explicitRoute?: ProcessingRoute | null
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
  explicitRoute?: ProcessingRoute | null
): Promise<ProcessFileResult> {
  const route = explicitRoute ?? classifyTransferProcessingRoute(file.name);
  const storageKey = buildTransferPrimaryStorageKey(transferId, file);
  if (!route) {
    return {
      file: buildSkippedFile(file.name, file.size, storageKey, file),
      uploadedBytes: file.size + (file.originalSize ?? 0),
    };
  }

  const buffer = await downloadBuffer(storageKey);
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

async function inferCompatibleTransferFileState(
  transferId: string,
  file: TransferFile
): Promise<TransferFile> {
  if (file.previewStatus && file.processingStatus && (file.processingRoute || file.processingStatus === "skipped")) {
    return file;
  }

  const route = classifyTransferProcessingRoute(file.filename);
  if (!route) {
    return {
      ...file,
      storageKey: file.storageKey ?? buildTransferPrimaryStorageKey(transferId, { name: file.filename }),
      previewStatus: "original_only",
      processingStatus: "skipped",
    };
  }

  const expected = getExpectedTransferAssetKeys(transferId, file.filename, route, file.id);
  const [thumbMeta, fullMeta] = await Promise.all([
    expected.thumbKey ? headObject(expected.thumbKey) : Promise.resolve({ exists: true }),
    expected.fullKey ? headObject(expected.fullKey) : Promise.resolve({ exists: true }),
  ]);

  if (thumbMeta.exists && fullMeta.exists) {
    return {
      ...file,
      storageKey: file.storageKey ?? buildTransferPrimaryStorageKey(transferId, { name: file.filename }),
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
      "legacy_missing_derivatives"
    ),
  };
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
  file: TransferFile
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
        route
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
    processTransferBuffer: async (buffer: Buffer, file: TransferUploadFileInput, transferId: string) => {
      const route = classifyTransferProcessingRoute(file.name);
      try {
        return await processTransferBufferLocally(
          buffer,
          { ...file, size: buffer.byteLength },
          transferId,
          "local_done",
          "local",
          route
        );
      } catch (error) {
        return buildFailedLocalResult({
          transferId,
          file: { ...file, size: buffer.byteLength },
          route: route ?? "local_image",
          buffer,
          code: isRawPreviewUnavailableError(error) ? "raw_preview_unavailable" : "processing_failed",
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
          code: isRawPreviewUnavailableError(error) ? "raw_preview_unavailable" : "processing_failed",
        });
      }
    },
    backfillTransferMedia: async (transfer: TransferData) => {
      const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
      if (remainingSeconds <= 0) return transfer;

      let changed = false;
      const nowMs = Date.now();
      const normalizedFiles = await Promise.all(
        transfer.files.map(async (file) => {
          const inferred = await inferCompatibleTransferFileState(transfer.id, file);
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
        })
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
  inferCompatibleTransferFileState,
  processTransferBufferLocally,
  processTransferObjectLocally,
};
