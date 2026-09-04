import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { formatBytes } from "@/lib/shared/format";
import { requireTransferUploadAccess } from "@/features/transfers/upload-access.server";
import {
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILES,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/features/transfers/store.server";
import { isSafeTransferFilename } from "@/features/transfers/upload.server";
import {
  HEIF_TRANSFER_UPLOAD_ERROR,
  isHeifUploadLike,
  resolveTransferUploadIds,
} from "@/features/transfers/media-state";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { buildTransferUrl } from "@/features/transfers/routes";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  TransferOperationsService,
  type TransferFinalizeResult,
} from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";

export const maxDuration = 300;
export const runtime = "nodejs";
type FileEntry = TransferUploadFileInput;

function completedResponse(
  request: Request,
  result: Extract<TransferFinalizeResult, { status: "completed" }>,
): Response {
  const transfer = result.transfer;
  return Response.json({
    shareUrl: buildTransferUrl(getBaseUrlForRequest(request), transfer.id),
    adminUrl: buildTransferUrl(getBaseUrlForRequest(request), transfer.id, transfer.deleteToken),
    transfer: {
      id: transfer.id,
      title: transfer.title,
      fileCount: transfer.files.length,
      expiresAt: transfer.expiresAt,
    },
    totalSize: result.totalSize,
    fileCounts: result.fileCounts,
    processingCounts: result.processingCounts,
    ...(result.deduplicated ? { deduplicated: true } : {}),
  });
}

/**
 * POST /api/upload/transfer/finalize
 *
 * Step 2 of the presigned upload flow.
 * Called after the client has uploaded all files directly to R2.
 * Downloads images to generate thumb/full variants, saves metadata to Redis.
 *
 * Body: { transferId, deleteToken, title, expiresSeconds, files: [{ name, size }] }
 * Returns: { shareUrl, adminUrl, transfer, totalSize, fileCounts }
 */
async function handlePOST(request: Request) {
  const { error: authErr, access } = await requireTransferUploadAccess(request);
  if (authErr) return authErr;
  const isAdmin = access.isAdmin;

  let body: {
    transferId?: string;
    deleteToken?: string;
    title?: string;
    expiresSeconds?: number;
    files?: FileEntry[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transferId, deleteToken, title, expiresSeconds, files: rawFiles } = body;

  if (!transferId || !deleteToken) {
    return Response.json({ error: "Missing transferId or deleteToken" }, { status: 400 });
  }
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }
  if (rawFiles.length > MAX_TRANSFER_FILES) {
    return Response.json(
      { error: `Choose at most ${MAX_TRANSFER_FILES} files per transfer` },
      { status: 400 },
    );
  }
  if (rawFiles.some((file) => !file || typeof file !== "object" || typeof file.name !== "string")) {
    return Response.json({ error: "Each file must have a safe filename" }, { status: 400 });
  }
  const files = resolveTransferUploadIds(rawFiles);
  let totalBytes = 0;
  const seenNames = new Set<string>();
  const seenArchivedNames = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !isSafeTransferFilename(file.name)) {
      return Response.json({ error: "Each file must have a safe filename" }, { status: 400 });
    }
    if (isHeifUploadLike(file)) {
      return Response.json({ error: HEIF_TRANSFER_UPLOAD_ERROR }, { status: 400 });
    }
    if (file.convertedFrom !== undefined && file.convertedFrom !== "browser_image") {
      return Response.json(
        { error: "Unsupported browser image preparation metadata" },
        { status: 400 },
      );
    }
    if (file.convertedFrom === "browser_image" && !file.originalName) {
      return Response.json(
        { error: "Browser-prepared images must include the original filename" },
        { status: 400 },
      );
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return Response.json(
        { error: "Each file must include a valid non-negative size" },
        { status: 400 },
      );
    }
    if (
      file.originalSize !== undefined &&
      (!Number.isFinite(file.originalSize) || file.originalSize < 0)
    ) {
      return Response.json(
        { error: "Each converted file must include a valid original size" },
        { status: 400 },
      );
    }
    if (!isAdmin && file.size > MAX_TRANSFER_FILE_BYTES) {
      return Response.json(
        { error: `File too large. Max ${formatBytes(MAX_TRANSFER_FILE_BYTES)} per file.` },
        { status: 400 },
      );
    }
    if (seenNames.has(file.name)) {
      return Response.json(
        { error: `Duplicate filename in upload selection: ${file.name}` },
        { status: 400 },
      );
    }
    seenNames.add(file.name);
    if (file.originalName) {
      if (!isSafeTransferFilename(file.originalName)) {
        return Response.json(
          { error: "Each converted file must include a safe original filename" },
          { status: 400 },
        );
      }
      if (seenArchivedNames.has(file.originalName)) {
        return Response.json(
          { error: `Duplicate archived filename in upload selection: ${file.originalName}` },
          { status: 400 },
        );
      }
      seenArchivedNames.add(file.originalName);
    }

    totalBytes += file.size + (file.originalSize ?? 0);
    if (!isAdmin && totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
      return Response.json(
        { error: `Transfer too large. Max ${formatBytes(MAX_TRANSFER_TOTAL_BYTES)} total.` },
        { status: 400 },
      );
    }
  }
  if (
    typeof expiresSeconds !== "number" ||
    expiresSeconds <= 0 ||
    expiresSeconds > MAX_EXPIRY_SECONDS
  ) {
    return Response.json({ error: "Invalid expiresSeconds" }, { status: 400 });
  }

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.finalizeUpload({
          transferId,
          deleteToken,
          actorJti: access.actorJti,
          title,
          expiresSeconds,
          files,
          maxTotalBytes: isAdmin ? undefined : MAX_TRANSFER_TOTAL_BYTES,
          ownerPersonId: access.ownerPersonId,
        });
      }),
      request.signal,
    );
    if (result.status === "completed") return completedResponse(request, result);
    if (result.status === "missing-reservation") {
      return Response.json({ error: "Upload reservation is missing or expired" }, { status: 409 });
    }
    if (result.status === "reservation-mismatch") {
      return Response.json(
        { error: "Upload reservation does not match this request" },
        { status: 403 },
      );
    }
    if (result.status === "size-mismatch") {
      return Response.json(
        {
          error: result.archivedOriginal
            ? `Archived original size does not match the reservation for ${result.filename}`
            : `Uploaded object size does not match the reservation for ${result.filename}`,
        },
        { status: 400 },
      );
    }
    if (result.status === "too-large") {
      return Response.json(
        { error: `Transfer too large. Max ${formatBytes(MAX_TRANSFER_TOTAL_BYTES)} total.` },
        { status: 400 },
      );
    }
    return Response.json({ error: "Transfer ID already exists" }, { status: 409 });
  } catch (e) {
    return apiErrorFromRequest(
      request,
      "upload.finalize",
      "Failed to finalize transfer. Files were uploaded but metadata could not be saved.",
      e,
      { transferId, fileCount: files.length },
    );
  }
}

export const Route = createFileRoute("/api/upload/transfer/finalize")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handlePOST as POST };
