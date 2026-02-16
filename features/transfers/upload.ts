/**
 * Transfer file processing pipeline.
 *
 * Shared between the upload API route (buffer from FormData) and the
 * CLI (buffer from disk). Classifies, processes, uploads variants to R2,
 * and returns structured metadata.
 */

import "server-only";

import path from "path";
import { uploadBuffer, downloadBuffer } from "@/lib/platform/r2";
import {
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  getMimeType,
  getFileKind,
  processImageVariants,
  processGifThumb,
} from "@/features/media/processing";
import type { TransferFile } from "./store";

/* ─── Types ─── */

type ProcessFileResult = {
  /** Metadata for this file (goes into the transfer manifest). */
  file: TransferFile;
  /** Total bytes uploaded to R2 (all variants combined). */
  uploadedBytes: number;
};

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
 * - GIFs → static thumb (WebP) + original (animation preserved)
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
 * Sort transfer files: visual (images/gifs) by EXIF date then name,
 * non-visual by name. Visual files come first.
 */
function sortTransferFiles(files: TransferFile[]): TransferFile[] {
  const visual = files.filter((f) => f.kind === "image" || f.kind === "gif");
  const nonVisual = files.filter(
    (f) => f.kind !== "image" && f.kind !== "gif"
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
 * - GIFs → generates static thumb, uploads variant
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

export { processTransferFile, processUploadedFile, sortTransferFiles };
export { isSafeTransferFilename };
export type { ProcessFileResult };
