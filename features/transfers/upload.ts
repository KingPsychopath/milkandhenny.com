/**
 * Transfer file processing pipeline.
 *
 * Shared between the upload API route (buffer from FormData) and the
 * CLI (buffer from disk). Execution is delegated to the active media
 * processor backend so the app can swap local/queued workers later.
 */

import "server-only";

import path from "path";
import { getMediaProcessor } from "@/features/media/processor";
import type { TransferData, TransferFile } from "./store";
import type { ProcessFileResult, TransferUploadFileInput } from "./upload-types";

/** Defensive filename validation for user-uploaded transfer files. */
function isSafeTransferFilename(filename: string): boolean {
  const name = filename.trim();
  if (!name || name.length > 180) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return path.basename(name) === name;
}

async function processTransferFile(
  buffer: Buffer,
  filename: string,
  transferId: string
): Promise<ProcessFileResult> {
  return getMediaProcessor().processTransferBuffer(buffer, filename, transferId);
}

async function processUploadedFile(
  file: TransferUploadFileInput,
  transferId: string
): Promise<ProcessFileResult> {
  return getMediaProcessor().processTransferObject(file, transferId);
}

async function backfillTransferMedia(transfer: TransferData): Promise<TransferData> {
  return getMediaProcessor().backfillTransferMedia(transfer);
}

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
    if (a.takenAt && b.takenAt) {
      return new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime();
    }
    if (a.takenAt) return -1;
    if (b.takenAt) return 1;
    return a.filename.localeCompare(b.filename);
  });

  nonVisual.sort((a, b) => a.filename.localeCompare(b.filename));

  return [...visual, ...nonVisual];
}

export { backfillTransferMedia, isSafeTransferFilename, processTransferFile, processUploadedFile, sortTransferFiles };
export type { ProcessFileResult };
