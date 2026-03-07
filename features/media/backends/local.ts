import "server-only";

import { downloadBuffer, headObject, uploadBuffer } from "@/lib/platform/r2";
import {
  getFileKind,
  getMimeType,
  processGifThumb,
  processImageVariants,
  processVideoVariants,
} from "@/features/media/processing";
import {
  classifyTransferProcessingRoute,
  getExpectedTransferAssetKeys,
  getTransferFileId,
  type ProcessingBackend,
  type ProcessingRoute,
  type ProcessingStatus,
} from "@/features/transfers/media-state";
import { saveTransfer, type TransferData, type TransferFile } from "@/features/transfers/store";
import type { ProcessFileResult } from "@/features/transfers/upload-types";

type CompletedProcessingStatus = Extract<ProcessingStatus, "local_done" | "worker_done">;

function buildSkippedFile(
  filename: string,
  size: number,
  mimeType = getMimeType(filename),
  kind: TransferFile["kind"] = getFileKind(filename)
): TransferFile {
  return {
    id: filename,
    filename,
    kind,
    size,
    mimeType,
    previewStatus: "original_only",
    processingStatus: "skipped",
  };
}

function getRouteKind(route: ProcessingRoute): TransferFile["kind"] {
  if (route === "local_video") return "video";
  if (route === "local_gif") return "gif";
  return "image";
}

function buildReadyVisualFile(
  filename: string,
  size: number,
  kind: TransferFile["kind"],
  mimeType: string,
  width: number,
  height: number,
  route: ProcessingRoute,
  processingStatus: CompletedProcessingStatus,
  processingBackend: ProcessingBackend,
  takenAt?: string | null
): TransferFile {
  return {
    id: getTransferFileId(filename),
    filename,
    kind,
    size,
    mimeType,
    width,
    height,
    ...(takenAt ? { takenAt } : {}),
    previewStatus: "ready",
    processingStatus,
    processingBackend,
    processingRoute: route,
    processingCompletedAt: new Date().toISOString(),
  };
}

function buildOriginalOnlyFailureFile(
  filename: string,
  size: number,
  route: ProcessingRoute,
  code = "processing_failed",
  retryCount = 0
): TransferFile {
  return {
    id: getTransferFileId(filename),
    filename,
    kind: getRouteKind(route),
    size,
    mimeType: getMimeType(filename),
    previewStatus: "original_only",
    processingStatus: "failed",
    processingRoute: route,
    processingErrorCode: code,
    retryCount,
  };
}

async function uploadOriginalBuffer(
  transferId: string,
  filename: string,
  buffer: Buffer
): Promise<void> {
  await uploadBuffer(`transfers/${transferId}/original/${filename}`, buffer, getMimeType(filename));
}

async function materializeVisualFromBuffer(params: {
  buffer: Buffer;
  filename: string;
  transferId: string;
  storedSize: number;
  originalAlreadyStored: boolean;
  route: ProcessingRoute;
  processingStatus: CompletedProcessingStatus;
  processingBackend: ProcessingBackend;
}): Promise<ProcessFileResult> {
  const {
    buffer,
    filename,
    transferId,
    storedSize,
    originalAlreadyStored,
    route,
    processingStatus,
    processingBackend,
  } = params;
  const prefix = `transfers/${transferId}`;
  const derivedId = getTransferFileId(filename);

  if (route === "local_gif") {
    const gif = await processGifThumb(buffer);
    await uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, gif.thumb.buffer, gif.thumb.contentType);
    if (!originalAlreadyStored) {
      await uploadOriginalBuffer(transferId, filename, buffer);
    }

    return {
      file: {
        id: derivedId,
        filename,
        kind: "gif",
        size: storedSize,
        mimeType: "image/gif",
        width: gif.width,
        height: gif.height,
        previewStatus: "ready",
        processingStatus,
        processingBackend,
        processingRoute: route,
        processingCompletedAt: new Date().toISOString(),
      },
      uploadedBytes: gif.thumb.buffer.byteLength + storedSize,
    };
  }

  if (route === "local_video") {
    const video = await processVideoVariants(buffer, filename);

    await Promise.all([
      uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, video.thumb.buffer, video.thumb.contentType),
      uploadBuffer(`${prefix}/full/${derivedId}.webp`, video.full.buffer, video.full.contentType),
      originalAlreadyStored ? Promise.resolve() : uploadOriginalBuffer(transferId, filename, buffer),
    ]);

    return {
      file: buildReadyVisualFile(
        filename,
        storedSize,
        "video",
        getMimeType(filename),
        video.width,
        video.height,
        route,
        processingStatus,
        processingBackend
      ),
      uploadedBytes:
        video.thumb.buffer.byteLength +
        video.full.buffer.byteLength +
        storedSize,
    };
  }

  const processed = await processImageVariants(buffer, filename);
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${derivedId}.webp`, processed.thumb.buffer, processed.thumb.contentType),
    uploadBuffer(`${prefix}/full/${derivedId}.webp`, processed.full.buffer, processed.full.contentType),
    originalAlreadyStored ? Promise.resolve() : uploadOriginalBuffer(transferId, filename, buffer),
  ]);

  return {
    file: buildReadyVisualFile(
      filename,
      storedSize,
      "image",
      getMimeType(filename),
      processed.width,
      processed.height,
      route,
      processingStatus,
      processingBackend,
      processed.takenAt
    ),
    uploadedBytes:
      processed.thumb.buffer.byteLength +
      processed.full.buffer.byteLength +
      storedSize,
  };
}

async function processTransferBufferLocally(
  buffer: Buffer,
  filename: string,
  transferId: string,
  processingStatus: CompletedProcessingStatus = "local_done",
  processingBackend: ProcessingBackend = "local",
  explicitRoute?: ProcessingRoute | null
): Promise<ProcessFileResult> {
  const route = explicitRoute ?? classifyTransferProcessingRoute(filename);
  if (!route) {
    await uploadOriginalBuffer(transferId, filename, buffer);
    return {
      file: buildSkippedFile(filename, buffer.byteLength),
      uploadedBytes: buffer.byteLength,
    };
  }

  return materializeVisualFromBuffer({
    buffer,
    filename,
    transferId,
    storedSize: buffer.byteLength,
    originalAlreadyStored: false,
    route,
    processingStatus,
    processingBackend,
  });
}

async function processTransferObjectLocally(
  filename: string,
  fileSize: number,
  transferId: string,
  processingStatus: CompletedProcessingStatus = "local_done",
  processingBackend: ProcessingBackend = "local",
  explicitRoute?: ProcessingRoute | null
): Promise<ProcessFileResult> {
  const route = explicitRoute ?? classifyTransferProcessingRoute(filename);
  if (!route) {
    return {
      file: buildSkippedFile(filename, fileSize),
      uploadedBytes: fileSize,
    };
  }

  const buffer = await downloadBuffer(`transfers/${transferId}/original/${filename}`);
  return materializeVisualFromBuffer({
    buffer,
    filename,
    transferId,
    storedSize: fileSize,
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
      previewStatus: "original_only",
      processingStatus: "skipped",
    };
  }

  const expected = getExpectedTransferAssetKeys(transferId, file.filename, route);
  const [thumbMeta, fullMeta] = await Promise.all([
    expected.thumbKey ? headObject(expected.thumbKey) : Promise.resolve({ exists: true }),
    expected.fullKey ? headObject(expected.fullKey) : Promise.resolve({ exists: true }),
  ]);

  if (thumbMeta.exists && fullMeta.exists) {
    return {
      ...file,
      previewStatus: "ready",
      processingStatus: "local_done",
      processingBackend: "local",
      processingRoute: route,
    };
  }

  return {
    ...file,
    ...buildOriginalOnlyFailureFile(file.filename, file.size, route, "legacy_missing_derivatives"),
  };
}

function createLocalMediaProcessor() {
  return {
    processTransferBuffer: (buffer: Buffer, filename: string, transferId: string) =>
      processTransferBufferLocally(buffer, filename, transferId),
    processTransferObject: (filename: string, fileSize: number, transferId: string) =>
      processTransferObjectLocally(filename, fileSize, transferId),
    backfillTransferMedia: async (transfer: TransferData) => {
      const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
      if (remainingSeconds <= 0) return transfer;

      const normalizedFiles = await Promise.all(
        transfer.files.map((file) => inferCompatibleTransferFileState(transfer.id, file))
      );

      if (JSON.stringify(normalizedFiles) === JSON.stringify(transfer.files)) {
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
  buildSkippedFile,
  createLocalMediaProcessor,
  getRouteKind,
  inferCompatibleTransferFileState,
  processTransferBufferLocally,
  processTransferObjectLocally,
};
