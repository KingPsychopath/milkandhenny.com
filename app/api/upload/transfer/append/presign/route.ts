import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithPayload } from "@/features/auth/server";
import { getTransfer } from "@/features/transfers/store";
import { isSafeTransferFilename } from "@/features/transfers/upload";
import { resolveTransferUploadIds } from "@/features/transfers/media-state";
import { presignPutUrl, isConfigured } from "@/lib/platform/r2";
import { getMimeType } from "@/features/media/processing";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "@/features/transfers/storage";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type FileEntry = TransferUploadFileInput;

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { error: authErr } = await requireAuthWithPayload(request, "admin");
  if (authErr) return authErr;

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 }
    );
  }

  let body: { transferId?: string; files?: FileEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transferId = body.transferId?.trim();
  const rawFiles = body.files;
  if (!transferId) {
    return NextResponse.json({ error: "Missing transferId" }, { status: 400 });
  }
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const transfer = await getTransfer(transferId);
  if (!transfer) {
    return NextResponse.json({ error: "Transfer not found or expired" }, { status: 404 });
  }
  const files = resolveTransferUploadIds(rawFiles, transfer.files.map((f) => f.id));

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000
  );
  if (remainingTtlSeconds <= 0) {
    return NextResponse.json({ error: "Transfer has already expired" }, { status: 400 });
  }

  const existingNames = new Set(transfer.files.map((f) => f.filename));
  const existingArchivedNames = new Set(
    transfer.files.flatMap((f) => [f.filename, f.originalFilename].filter((value): value is string => typeof value === "string"))
  );
  const seenNames = new Set<string>();
  const seenArchivedNames = new Set<string>();

  for (const file of files) {
    if (!file || typeof file.name !== "string" || !isSafeTransferFilename(file.name)) {
      return NextResponse.json({ error: "Each file must have a safe filename" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json({ error: "Each file must include a valid non-negative size" }, { status: 400 });
    }
    if (file.originalSize !== undefined && (!Number.isFinite(file.originalSize) || file.originalSize < 0)) {
      return NextResponse.json({ error: "Each converted file must include a valid original size" }, { status: 400 });
    }
    if (seenNames.has(file.name)) {
      return NextResponse.json({ error: `Duplicate filename in upload selection: ${file.name}` }, { status: 400 });
    }
    if (existingNames.has(file.name)) {
      return NextResponse.json({ error: `Filename already exists in transfer: ${file.name}` }, { status: 400 });
    }
    seenNames.add(file.name);
    if (file.originalName) {
      if (!isSafeTransferFilename(file.originalName)) {
        return NextResponse.json({ error: "Each converted file must include a safe original filename" }, { status: 400 });
      }
      if (seenArchivedNames.has(file.originalName) || existingArchivedNames.has(file.originalName)) {
        return NextResponse.json({ error: `Archived filename already exists in transfer: ${file.originalName}` }, { status: 400 });
      }
      seenArchivedNames.add(file.originalName);
    }
  }

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
      })
    );

    return NextResponse.json({
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
      { transferId, fileCount: files.length }
    );
  }
}
