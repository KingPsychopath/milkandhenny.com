import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithPayload } from "@/features/auth/server";
import { presignPutUrl, isConfigured } from "@/lib/platform/r2";
import {
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/features/transfers/store";
import { getMimeType } from "@/features/media/processing";
import { resolveTransferUploadIds } from "@/features/transfers/media-state";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "@/features/transfers/storage";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isSafeTransferFilename } from "@/features/transfers/upload";

type FileEntry = TransferUploadFileInput;

export const runtime = "nodejs";

/**
 * POST /api/upload/transfer/presign
 *
 * Step 1 of the presigned upload flow.
 * Generates a transferId, deleteToken, and presigned PUT URLs for each file.
 * The client uploads directly to R2 — no file bytes pass through Vercel.
 *
 * Body: { title, expires?, files: [{ name, size, type? }] }
 * Returns: { transferId, deleteToken, expiresSeconds, urls: [{ name, url }] }
 */
export async function POST(request: NextRequest) {
  const { error: authErr, payload } = await requireAuthWithPayload(request, "upload");
  if (authErr) return authErr;
  const isAdmin = payload?.role === "admin";

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 }
    );
  }

  let body: { title?: string; expires?: string; files?: FileEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawFiles = body.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  const files = resolveTransferUploadIds(rawFiles);
  let totalBytes = 0;
  const seenNames = new Set<string>();
  const seenArchivedNames = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !isSafeTransferFilename(file.name)) {
      return NextResponse.json(
        { error: "Each file must have a safe filename" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json(
        { error: "Each file must include a valid non-negative size" },
        { status: 400 }
      );
    }
    if (file.originalSize !== undefined && (!Number.isFinite(file.originalSize) || file.originalSize < 0)) {
      return NextResponse.json({ error: "Each converted file must include a valid original size" }, { status: 400 });
    }
    if (!isAdmin && file.size > MAX_TRANSFER_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max 250MB per file." },
        { status: 400 }
      );
    }
    if (seenNames.has(file.name)) {
      return NextResponse.json(
        { error: `Duplicate filename in upload selection: ${file.name}` },
        { status: 400 }
      );
    }
    seenNames.add(file.name);
    if (file.originalName) {
      if (!isSafeTransferFilename(file.originalName)) {
        return NextResponse.json({ error: "Each converted file must include a safe original filename" }, { status: 400 });
      }
      if (seenArchivedNames.has(file.originalName)) {
        return NextResponse.json({ error: `Duplicate archived filename in upload selection: ${file.originalName}` }, { status: 400 });
      }
      seenArchivedNames.add(file.originalName);
    }

    totalBytes += file.size + (file.originalSize ?? 0);
    if (!isAdmin && totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
      return NextResponse.json(
        { error: "Transfer too large. Max 1GB total." },
        { status: 400 }
      );
    }
  }

  let expiresSeconds = DEFAULT_EXPIRY_SECONDS;
  if (body.expires) {
    try {
      expiresSeconds = parseExpiry(body.expires);
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 }
      );
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
          primaryUrl,
          archivedOriginalUrl,
        };
      })
    );

    return NextResponse.json({
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
      { transferId, fileCount: files.length }
    );
  }
}
