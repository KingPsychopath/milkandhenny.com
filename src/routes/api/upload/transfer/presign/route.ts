import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { formatBytes } from "@/lib/shared/format";
import { requireTransferUploadAccess } from "@/features/transfers/upload-access.server";
import { isTransferStorageConfigured } from "@/lib/platform/r2.server";
import {
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_FILES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/features/transfers/store.server";
import {
  HEIF_TRANSFER_UPLOAD_ERROR,
  isHeifUploadLike,
  resolveTransferUploadIds,
} from "@/features/transfers/media-state";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  getUploadUrlTtlSeconds,
  MAX_MULTIPART_FILE_BYTES,
} from "@/features/transfers/upload-window.server";
import { isSafeTransferFilename } from "@/features/transfers/upload.server";

type FileEntry = TransferUploadFileInput;

export const runtime = "nodejs";

/**
 * POST /api/upload/transfer/presign
 *
 * Step 1 of the presigned upload flow.
 * Generates a transferId, deleteToken, and presigned PUT URLs for each file.
 * The client uploads directly to object storage; file bytes bypass the app host.
 *
 * Body: { title, expires?, files: [{ name, size, type? }] }
 * Returns: { transferId, deleteToken, expiresSeconds, urls: [{ name, url }] }
 */
async function handlePOST(request: Request) {
  const { error: authErr, access } = await requireTransferUploadAccess(request);
  if (authErr) return authErr;
  const isAdmin = access.isAdmin;

  if (!isTransferStorageConfigured()) {
    return Response.json(
      { error: "Private transfer storage is not configured. Set R2_PRIVATE_BUCKET." },
      { status: 503 },
    );
  }

  let body: { title?: string; expires?: string; files?: FileEntry[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawFiles = body.files;
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
    if (file.size > MAX_MULTIPART_FILE_BYTES) {
      return Response.json(
        {
          error: `File too large. Max ${formatBytes(MAX_MULTIPART_FILE_BYTES)} per file.`,
        },
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

  let expiresSeconds = DEFAULT_EXPIRY_SECONDS;
  if (body.expires) {
    try {
      expiresSeconds = parseExpiry(body.expires);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const uploadUrlTtlSeconds = getUploadUrlTtlSeconds();
  const transferId = generateTransferId();
  const deleteToken = generateDeleteToken();
  const boundedExpiresSeconds = Math.min(expiresSeconds, MAX_EXPIRY_SECONDS);

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.presignUpload({
          transferId,
          deleteToken,
          actorJti: access.actorJti,
          expiresSeconds: boundedExpiresSeconds,
          files,
          uploadUrlTtlSeconds,
        });
      }),
      request.signal,
    );
    if (result.status === "reservation-conflict") {
      return Response.json(
        { error: "Unable to reserve transfer ID. Please retry." },
        { status: 409 },
      );
    }

    return Response.json({
      transferId,
      deleteToken,
      expiresSeconds: boundedExpiresSeconds,
      urls: result.urls,
    });
  } catch (e) {
    return apiErrorFromRequest(
      request,
      "upload.presign",
      "Failed to generate upload URLs. Please try again.",
      e,
      { transferId, fileCount: files.length },
    );
  }
}

export const Route = createFileRoute("/api/upload/transfer/presign")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handlePOST as POST };
