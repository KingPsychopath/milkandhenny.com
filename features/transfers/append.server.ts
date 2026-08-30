import { formatBytes } from "@/lib/shared/format";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { headObject, presignPutUrl, isTransferStorageConfigured } from "@/lib/platform/r2.server";
import { getMimeType } from "@/features/media/processing.server";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";
import {
  appendTransferFiles,
  getTransfer,
  MAX_TRANSFER_FILES,
  updateTransferGrouping,
} from "./store.server";
import {
  applyTransferAssetGroups,
  isSafeTransferFilename,
  processUploadedFile,
  sortTransferFiles,
} from "./upload.server";
import {
  buildTransferProcessingCounts,
  HEIF_TRANSFER_UPLOAD_ERROR,
  isHeifUploadLike,
  resolveTransferUploadIds,
} from "./media-state";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "./storage";
import { getUploadUrlTtlSeconds, MAX_SINGLE_PUT_BYTES } from "./upload-window.server";
import { buildTransferUrl } from "./routes";
import type { TransferUploadFileInput } from "./upload-types";

/**
 * Appending files to an existing transfer, shared by two callers:
 *
 * - the admin append routes, where the caller names any transfer, and
 * - event guest drops, where a bearer token maps to exactly one transfer.
 *
 * Authorisation stays with the caller; everything below assumes the caller
 * already decided this request may touch this transfer.
 */

const FINALIZE_CONCURRENCY = 2;

type FileEntry = TransferUploadFileInput;

export type AppendLimits = {
  /** Cap per request — guests upload in batches, not archives. */
  maxFiles?: number;
  /** Per-file byte cap below the hard single-PUT limit. */
  maxFileBytes?: number;
  /** Total live bytes after this batch is recorded. */
  maxTotalBytes?: number;
};

type Prepared =
  | {
      ok: true;
      files: FileEntry[];
      transfer: NonNullable<Awaited<ReturnType<typeof getTransfer>>>;
      remainingTtlSeconds: number;
    }
  | { ok: false; response: Response };

/** Shared validation for both phases: shape, names, HEIF, duplicates, size. */
async function prepare(
  transferId: string,
  rawFiles: unknown,
  limits: AppendLimits,
): Promise<Prepared> {
  const reject = (error: string, status = 400): Prepared => ({
    ok: false,
    response: Response.json({ error }, { status }),
  });

  if (!isTransferStorageConfigured()) {
    return reject("Private transfer storage is not configured. Set R2_PRIVATE_BUCKET.", 503);
  }
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return reject("No files provided");
  if (limits.maxFiles && rawFiles.length > limits.maxFiles) {
    return reject(`Upload at most ${limits.maxFiles} files at a time`);
  }
  if (rawFiles.length > MAX_TRANSFER_FILES) {
    return reject(`Upload at most ${MAX_TRANSFER_FILES} files at a time`);
  }
  if (rawFiles.some((file) => !file || typeof file !== "object" || typeof file.name !== "string")) {
    return reject("Each file must have a safe filename");
  }

  const transfer = await getTransfer(transferId);
  if (!transfer) return reject("Transfer not found or expired", 404);
  if (transfer.files.length + rawFiles.length > MAX_TRANSFER_FILES) {
    return reject(`A transfer can contain at most ${MAX_TRANSFER_FILES} files`, 409);
  }

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000,
  );
  if (remainingTtlSeconds <= 0) return reject("Transfer has already expired");

  const files = resolveTransferUploadIds(
    rawFiles as FileEntry[],
    transfer.files.map((f) => f.id),
  );

  const maxBytes = Math.min(limits.maxFileBytes ?? MAX_SINGLE_PUT_BYTES, MAX_SINGLE_PUT_BYTES);
  const existingArchivedNames = new Set(
    transfer.files.flatMap((f) =>
      [f.filename, f.originalFilename].filter(
        (value): value is string => typeof value === "string",
      ),
    ),
  );
  const seenNames = new Set<string>();
  const seenArchivedNames = new Set<string>();

  for (const file of files) {
    if (!file || typeof file.name !== "string" || !isSafeTransferFilename(file.name)) {
      return reject("Each file must have a safe filename");
    }
    if (isHeifUploadLike(file)) return reject(HEIF_TRANSFER_UPLOAD_ERROR);
    if (file.convertedFrom !== undefined && file.convertedFrom !== "browser_image") {
      return reject("Unsupported browser image preparation metadata");
    }
    if (file.convertedFrom === "browser_image" && !file.originalName) {
      return reject("Browser-prepared images must include the original filename");
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return reject("Each file must include a valid non-negative size");
    }
    if (file.size > maxBytes) {
      return reject(`File too large. Max ${formatBytes(maxBytes)} per file.`);
    }
    if (
      file.originalSize !== undefined &&
      (!Number.isFinite(file.originalSize) || file.originalSize < 0)
    ) {
      return reject("Each converted file must include a valid original size");
    }
    if (seenNames.has(file.name)) {
      return reject(`Duplicate filename in upload selection: ${file.name}`);
    }
    if (existingArchivedNames.has(file.name)) {
      return reject(`Filename already exists in transfer: ${file.name}`);
    }
    seenNames.add(file.name);
    if (file.originalName) {
      if (!isSafeTransferFilename(file.originalName)) {
        return reject("Each converted file must include a safe original filename");
      }
      if (
        seenArchivedNames.has(file.originalName) ||
        existingArchivedNames.has(file.originalName)
      ) {
        return reject(`Archived filename already exists in transfer: ${file.originalName}`);
      }
      seenArchivedNames.add(file.originalName);
    }
  }

  if (limits.maxTotalBytes) {
    const existingBytes = transfer.files.reduce(
      (total, file) => total + (file.storedBytes ?? file.size),
      0,
    );
    const incomingBytes = files.reduce(
      (total, file) => total + file.size + (file.originalSize ?? 0),
      0,
    );
    if (existingBytes + incomingBytes > limits.maxTotalBytes) {
      return reject(
        `This transfer has reached its ${formatBytes(limits.maxTotalBytes)} limit`,
        409,
      );
    }
  }

  return { ok: true, files, transfer, remainingTtlSeconds };
}

/** Phase one: presigned PUT URLs for every file in the batch. */
export async function appendPresign(
  request: Request,
  transferId: string,
  rawFiles: unknown,
  limits: AppendLimits = {},
): Promise<Response> {
  const prepared = await prepare(transferId, rawFiles, limits);
  if (!prepared.ok) return prepared.response;
  const { files, transfer, remainingTtlSeconds } = prepared;

  const uploadUrlTtlSeconds = getUploadUrlTtlSeconds();
  try {
    const urls = await Promise.all(
      files.map(async (file) => {
        const primaryKey = buildTransferPrimaryStorageKey(transferId, file);
        const primaryUrl = await presignPutUrl(
          primaryKey,
          getMimeType(file.name),
          uploadUrlTtlSeconds,
          { scope: "private" },
        );
        const archivedOriginalKey = buildTransferArchivedOriginalStorageKey(transferId, file);
        const archivedOriginalUrl =
          archivedOriginalKey && file.originalName
            ? await presignPutUrl(
                archivedOriginalKey,
                getMimeType(file.originalName),
                uploadUrlTtlSeconds,
                { scope: "private" },
              )
            : undefined;
        return {
          name: file.name,
          mediaId: file.mediaId,
          contentType: getMimeType(file.name),
          primaryUrl,
          archivedOriginalUrl,
        };
      }),
    );

    return Response.json({
      transfer: {
        id: transfer.id,
        title: transfer.title,
        fileCount: transfer.files.length,
        expiresAt: transfer.expiresAt,
      },
      urls,
      remainingTtlSeconds,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.transfer.append.presign",
      "Failed to generate append upload URLs. Please try again.",
      error,
      { transferId, fileCount: files.length },
    );
  }
}

/** Phase two: record uploaded files on the transfer and queue processing. */
export async function appendFinalize(
  request: Request,
  transferId: string,
  rawFiles: unknown,
  limits: AppendLimits = {},
): Promise<Response> {
  const prepared = await prepare(transferId, rawFiles, limits);
  if (!prepared.ok) return prepared.response;
  const { files, transfer } = prepared;

  try {
    const uploadedObjects = await mapWithConcurrency(files, FINALIZE_CONCURRENCY, async (file) => {
      const primaryKey = buildTransferPrimaryStorageKey(transferId, file);
      const archivedKey = buildTransferArchivedOriginalStorageKey(transferId, file);
      const [primary, archived] = await Promise.all([
        headObject(primaryKey, { scope: "private" }),
        archivedKey ? headObject(archivedKey, { scope: "private" }) : Promise.resolve(null),
      ]);
      return { file, primary, archived };
    });
    for (const { file, primary, archived } of uploadedObjects) {
      if (!primary.exists || primary.size !== file.size) {
        return Response.json(
          { error: `Uploaded object size does not match the reservation for ${file.name}` },
          { status: 409 },
        );
      }
      if (file.originalName && (!archived?.exists || archived.size !== file.originalSize)) {
        return Response.json(
          { error: `Archived original size does not match the reservation for ${file.name}` },
          { status: 409 },
        );
      }
    }

    const results = await mapWithConcurrency(files, FINALIZE_CONCURRENCY, async (file) => {
      const result = await processUploadedFile(file, transferId);
      return {
        ...result,
        file: { ...result.file, storedBytes: file.size + (file.originalSize ?? 0) },
      };
    });
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };
    for (const result of results) {
      const k = result.file.kind;
      if (k === "image") counts.images++;
      else if (k === "gif") counts.gifs++;
      else if (k === "video") counts.videos++;
      else if (k === "audio") counts.audio++;
      else counts.other++;
    }

    const appended = await appendTransferFiles(
      transferId,
      results.map((result) => result.file),
      { maxFiles: MAX_TRANSFER_FILES, maxTotalBytes: limits.maxTotalBytes },
    );
    if (!("transfer" in appended)) {
      if (appended.status === "missing") {
        return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
      }
      if (appended.status === "limit") {
        return Response.json(
          { error: "That upload would exceed this transfer's limits" },
          { status: 409 },
        );
      }
      return Response.json(
        { error: "One of those filenames was added while this upload was finishing" },
        { status: 409 },
      );
    }

    let latest = appended.transfer;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const grouped = applyTransferAssetGroups(sortTransferFiles(latest.files));
      if (await updateTransferGrouping(transferId, grouped.files, grouped.groups)) break;
      const refreshed = await getTransfer(transferId);
      if (!refreshed) {
        return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
      }
      latest = refreshed;
    }
    const updatedTransfer = (await getTransfer(transferId)) ?? latest;

    const totalSize = results.reduce((sum, r) => sum + r.uploadedBytes, 0);
    const processingCounts = buildTransferProcessingCounts(results.map((r) => r.file));

    return Response.json({
      shareUrl: buildTransferUrl(getBaseUrlForRequest(request), transferId),
      adminUrl: buildTransferUrl(getBaseUrlForRequest(request), transferId, transfer.deleteToken),
      transfer: {
        id: transferId,
        title: transfer.title,
        fileCount: updatedTransfer.files.length,
        expiresAt: transfer.expiresAt,
      },
      addedCount: results.length,
      totalSize,
      fileCounts: counts,
      processingCounts,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.transfer.append.finalize",
      "Append upload succeeded but finalization failed.",
      error,
      { transferId, fileCount: files.length },
    );
  }
}
