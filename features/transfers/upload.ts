/**
 * Transfer file processing pipeline.
 *
 * Shared between the upload API route (buffer from FormData) and the
 * CLI (buffer from disk). Classifies, processes, uploads variants to R2,
 * and returns structured metadata.
 */

import "server-only";

import path from "path";
import { uploadBuffer, downloadBuffer, headObject } from "@/lib/platform/r2";
import {
  PROCESSABLE_EXTENSIONS,
  RAW_IMAGE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  VIDEO_EXTENSIONS,
  mapConcurrent,
  getMimeType,
  getFileKind,
  processImageVariants,
  processGifThumb,
  processVideoVariants,
} from "@/features/media/processing";
import { saveTransfer, type TransferData, type TransferFile } from "./store";

/* ─── Types ─── */

type ProcessFileResult = {
  /** Metadata for this file (goes into the transfer manifest). */
  file: TransferFile;
  /** Total bytes uploaded to R2 (all variants combined). */
  uploadedBytes: number;
};

const TRANSFER_BACKFILL_CONCURRENCY = 2;

/** Defensive filename validation for user-uploaded transfer files. */
function isSafeTransferFilename(filename: string): boolean {
  const name = filename.trim();
  if (!name || name.length > 180) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return path.basename(name) === name;
}

/* ─── Processing ─── */

/**
 * Process a single file for a transfer: classify → process → upload to R2.
 *
 * - Processable images → thumb (600px WebP) + full (1600px WebP) + original (JPEG)
 * - RAW images → thumb/full from embedded preview + original RAW preserved
 * - GIFs → static thumb (WebP) + original (animation preserved)
 * - Videos → thumb/full posters from ffmpeg + original video preserved
 * - Everything else → uploaded raw
 */
async function processTransferFile(
  buffer: Buffer,
  filename: string,
  transferId: string
): Promise<ProcessFileResult> {
  const ext = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, ext);
  const prefix = `transfers/${transferId}`;

  if (PROCESSABLE_EXTENSIONS.test(filename)) {
    const processed = await processImageVariants(buffer, ext);
    const originalFilename =
      processed.original.ext === ext
        ? filename
        : `${stem}${processed.original.ext}`;

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        processed.thumb.buffer,
        processed.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        processed.full.buffer,
        processed.full.contentType
      ),
      uploadBuffer(
        `${prefix}/original/${originalFilename}`,
        processed.original.buffer,
        processed.original.contentType
      ),
    ]);

    return {
      file: {
        id: stem,
        filename: originalFilename,
        kind: "image",
        size: buffer.byteLength,
        mimeType: processed.original.contentType,
        width: processed.width,
        height: processed.height,
        ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
      },
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        processed.original.buffer.byteLength,
    };
  }

  if (RAW_IMAGE_EXTENSIONS.test(filename)) {
    const processed = await processImageVariants(buffer, ext);
    const mimeType = getMimeType(filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        processed.thumb.buffer,
        processed.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        processed.full.buffer,
        processed.full.contentType
      ),
      uploadBuffer(`${prefix}/original/${filename}`, buffer, mimeType),
    ]);

    return {
      file: {
        id: stem,
        filename,
        kind: "image",
        size: buffer.byteLength,
        mimeType,
        width: processed.width,
        height: processed.height,
        ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
      },
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        buffer.byteLength,
    };
  }

  if (ANIMATED_EXTENSIONS.test(filename)) {
    const gif = await processGifThumb(buffer);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        gif.thumb.buffer,
        gif.thumb.contentType
      ),
      uploadBuffer(`${prefix}/original/${filename}`, buffer, "image/gif"),
    ]);

    return {
      file: {
        id: stem,
        filename,
        kind: "gif",
        size: buffer.byteLength,
        mimeType: "image/gif",
        width: gif.width,
        height: gif.height,
      },
      uploadedBytes: gif.thumb.buffer.byteLength + buffer.byteLength,
    };
  }

  if (VIDEO_EXTENSIONS.test(filename)) {
    const video = await processVideoVariants(buffer, ext);
    const mimeType = getMimeType(filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        video.thumb.buffer,
        video.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        video.full.buffer,
        video.full.contentType
      ),
      uploadBuffer(`${prefix}/original/${filename}`, buffer, mimeType),
    ]);

    return {
      file: {
        id: stem,
        filename,
        kind: "video",
        size: buffer.byteLength,
        mimeType,
        width: video.width,
        height: video.height,
      },
      uploadedBytes:
        video.thumb.buffer.byteLength +
        video.full.buffer.byteLength +
        buffer.byteLength,
    };
  }

  // Raw file — upload as-is
  const mimeType = getMimeType(filename);
  const kind = getFileKind(filename);

  await uploadBuffer(`${prefix}/original/${filename}`, buffer, mimeType);

  return {
    file: {
      id: filename,
      filename,
      kind,
      size: buffer.byteLength,
      mimeType,
    },
    uploadedBytes: buffer.byteLength,
  };
}

/* ─── Sorting ─── */

/**
 * Sort transfer files: visual (images/gifs/videos) by EXIF date then name,
 * non-visual by name. Visual files come first.
 */
function sortTransferFiles(files: TransferFile[]): TransferFile[] {
  const visual = files.filter((f) => f.kind === "image" || f.kind === "gif" || f.kind === "video");
  const nonVisual = files.filter(
    (f) => f.kind !== "image" && f.kind !== "gif" && f.kind !== "video"
  );

  visual.sort((a, b) => {
    if (a.takenAt && b.takenAt)
      return new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime();
    if (a.takenAt) return -1;
    if (b.takenAt) return 1;
    return a.filename.localeCompare(b.filename);
  });

  nonVisual.sort((a, b) => a.filename.localeCompare(b.filename));

  return [...visual, ...nonVisual];
}

/**
 * Process a file that was already uploaded to R2 via presigned URL.
 *
 * - Downloads the original from R2
 * - Processable images → generates thumb + full, uploads variants
 * - RAW images → extracts embedded preview, generates thumb + full, keeps original RAW
 * - GIFs → generates static thumb, uploads variant
 * - Videos → generates thumb + full posters, keeps original video
 * - Everything else → no processing, just returns metadata
 *
 * The original is untouched in R2 (already uploaded by the client).
 */
async function processUploadedFile(
  filename: string,
  fileSize: number,
  transferId: string
): Promise<ProcessFileResult> {
  const ext = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, ext);
  const prefix = `transfers/${transferId}`;
  const originalKey = `${prefix}/original/${filename}`;

  if (PROCESSABLE_EXTENSIONS.test(filename)) {
    const buffer = await downloadBuffer(originalKey);
    const processed = await processImageVariants(buffer, ext);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        processed.thumb.buffer,
        processed.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        processed.full.buffer,
        processed.full.contentType
      ),
    ]);

    const originalFilename =
      processed.original.ext === ext
        ? filename
        : `${stem}${processed.original.ext}`;

    return {
      file: {
        id: stem,
        filename: originalFilename,
        kind: "image",
        size: fileSize,
        mimeType: processed.original.contentType,
        width: processed.width,
        height: processed.height,
        ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
      },
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        fileSize,
    };
  }

  if (RAW_IMAGE_EXTENSIONS.test(filename)) {
    const buffer = await downloadBuffer(originalKey);
    const processed = await processImageVariants(buffer, ext);
    const mimeType = getMimeType(filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        processed.thumb.buffer,
        processed.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        processed.full.buffer,
        processed.full.contentType
      ),
    ]);

    return {
      file: {
        id: stem,
        filename,
        kind: "image",
        size: fileSize,
        mimeType,
        width: processed.width,
        height: processed.height,
        ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
      },
      uploadedBytes:
        processed.thumb.buffer.byteLength +
        processed.full.buffer.byteLength +
        fileSize,
    };
  }

  if (ANIMATED_EXTENSIONS.test(filename)) {
    const buffer = await downloadBuffer(originalKey);
    const gif = await processGifThumb(buffer);

    await uploadBuffer(
      `${prefix}/thumb/${stem}.webp`,
      gif.thumb.buffer,
      gif.thumb.contentType
    );

    return {
      file: {
        id: stem,
        filename,
        kind: "gif",
        size: fileSize,
        mimeType: "image/gif",
        width: gif.width,
        height: gif.height,
      },
      uploadedBytes: gif.thumb.buffer.byteLength + fileSize,
    };
  }

  if (VIDEO_EXTENSIONS.test(filename)) {
    const buffer = await downloadBuffer(originalKey);
    const video = await processVideoVariants(buffer, ext);
    const mimeType = getMimeType(filename);

    await Promise.all([
      uploadBuffer(
        `${prefix}/thumb/${stem}.webp`,
        video.thumb.buffer,
        video.thumb.contentType
      ),
      uploadBuffer(
        `${prefix}/full/${stem}.webp`,
        video.full.buffer,
        video.full.contentType
      ),
    ]);

    return {
      file: {
        id: stem,
        filename,
        kind: "video",
        size: fileSize,
        mimeType,
        width: video.width,
        height: video.height,
      },
      uploadedBytes:
        video.thumb.buffer.byteLength +
        video.full.buffer.byteLength +
        fileSize,
    };
  }

  // Non-visual file — already in R2, just build metadata
  const mimeType = getMimeType(filename);
  const kind = getFileKind(filename);

  return {
    file: {
      id: filename,
      filename,
      kind,
      size: fileSize,
      mimeType,
    },
    uploadedBytes: fileSize,
  };
}

function requiresTransferBackfill(file: TransferFile, transferId: string): {
  expectedThumbKey?: string;
  expectedFullKey?: string;
  shouldProcess: boolean;
} {
  const ext = path.extname(file.filename).toLowerCase();
  const derivedId = path.basename(file.filename, ext);
  const prefix = `transfers/${transferId}`;
  const visualKind =
    file.kind === "image" ||
    file.kind === "gif" ||
    file.kind === "video" ||
    RAW_IMAGE_EXTENSIONS.test(file.filename) ||
    ANIMATED_EXTENSIONS.test(file.filename) ||
    VIDEO_EXTENSIONS.test(file.filename) ||
    PROCESSABLE_EXTENSIONS.test(file.filename);

  if (!visualKind) {
    return { shouldProcess: false };
  }

  if (ANIMATED_EXTENSIONS.test(file.filename) || file.kind === "gif") {
    return {
      shouldProcess: true,
      expectedThumbKey: `${prefix}/thumb/${derivedId}.webp`,
    };
  }

  if (
    VIDEO_EXTENSIONS.test(file.filename) ||
    file.kind === "video" ||
    RAW_IMAGE_EXTENSIONS.test(file.filename) ||
    PROCESSABLE_EXTENSIONS.test(file.filename) ||
    file.kind === "image"
  ) {
    return {
      shouldProcess: true,
      expectedThumbKey: `${prefix}/thumb/${derivedId}.webp`,
      expectedFullKey: `${prefix}/full/${derivedId}.webp`,
    };
  }

  return { shouldProcess: false };
}

async function backfillTransferMedia(transfer: TransferData): Promise<TransferData> {
  const remainingSeconds = Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) return transfer;

  const candidates = await mapConcurrent(
    transfer.files,
    TRANSFER_BACKFILL_CONCURRENCY,
    async (file) => {
      const backfill = requiresTransferBackfill(file, transfer.id);
      if (!backfill.shouldProcess) return null;

      const [thumbMeta, fullMeta] = await Promise.all([
        backfill.expectedThumbKey ? headObject(backfill.expectedThumbKey) : Promise.resolve({ exists: true }),
        backfill.expectedFullKey ? headObject(backfill.expectedFullKey) : Promise.resolve({ exists: true }),
      ]);

      if (thumbMeta.exists && fullMeta.exists) return null;

      try {
        const processed = await processUploadedFile(file.filename, file.size, transfer.id);
        return processed.file;
      } catch {
        return null;
      }
    }
  );

  const replacements = new Map(
    candidates
      .filter((file): file is TransferFile => !!file)
      .map((file) => [file.filename, file])
  );

  if (replacements.size === 0) return transfer;

  const updated: TransferData = {
    ...transfer,
    files: transfer.files.map((file) => replacements.get(file.filename) ?? file),
  };

  await saveTransfer(updated, remainingSeconds);
  return updated;
}

export { processTransferFile, processUploadedFile, sortTransferFiles };
export { backfillTransferMedia };
export { isSafeTransferFilename };
export type { ProcessFileResult };
