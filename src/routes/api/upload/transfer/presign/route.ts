import { createFileRoute } from "@tanstack/react-router";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { presignPutUrl, isTransferStorageConfigured } from "@/lib/platform/r2.server";
import {
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/features/transfers/store.server";
import { getMimeType } from "@/features/media/processing.server";
import {
  HEIF_TRANSFER_UPLOAD_ERROR,
  isHeifUploadLike,
  resolveTransferUploadIds,
} from "@/features/transfers/media-state";
import {
  buildTransferArchivedOriginalStorageKey,
  buildTransferPrimaryStorageKey,
} from "@/features/transfers/storage";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
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
  const { error: authErr, payload } = await requireAuthWithPayload(request, "upload");
  if (authErr) return authErr;
  const isAdmin = payload?.role === "admin";

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
      return Response.json({ error: "File too large. Max 250MB per file." }, { status: 400 });
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
      return Response.json({ error: "Transfer too large. Max 1GB total." }, { status: 400 });
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

  const transferId = generateTransferId();
  const deleteToken = generateDeleteToken();

  try {
    const urls = await Promise.all(
      files.map(async (file) => {
        const primaryKey = buildTransferPrimaryStorageKey(transferId, file);
        const primaryUrl = await presignPutUrl(primaryKey, getMimeType(file.name));
        const archivedOriginalKey = buildTransferArchivedOriginalStorageKey(transferId, file);
        const archivedOriginalUrl =
          archivedOriginalKey && file.originalName
            ? await presignPutUrl(archivedOriginalKey, getMimeType(file.originalName))
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
      transferId,
      deleteToken,
      expiresSeconds: Math.min(expiresSeconds, MAX_EXPIRY_SECONDS),
      urls,
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
