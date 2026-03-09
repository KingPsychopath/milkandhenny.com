import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithPayload } from "@/features/auth/server";
import {
  saveTransfer,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/features/transfers/store";
import {
  applyTransferAssetGroups,
  processUploadedFile,
  sortTransferFiles,
  isSafeTransferFilename,
} from "@/features/transfers/upload";
import {
  buildTransferProcessingCounts,
  HEIF_TRANSFER_UPLOAD_ERROR,
  isHeifUploadLike,
  resolveTransferUploadIds,
} from "@/features/transfers/media-state";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { BASE_URL, hasPublicR2Url } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

export const maxDuration = 15;
export const runtime = "nodejs";
const FINALIZE_CONCURRENCY = 2;

type FileEntry = TransferUploadFileInput;

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
export async function POST(request: NextRequest) {
  const { error: authErr, payload } = await requireAuthWithPayload(request, "upload");
  if (authErr) return authErr;
  const isAdmin = payload?.role === "admin";

  if (!hasPublicR2Url()) {
    return NextResponse.json(
      {
        error:
          "Transfers are not viewable because NEXT_PUBLIC_R2_PUBLIC_URL is missing. Configure the public R2/CDN URL before uploading.",
      },
      { status: 503 }
    );
  }

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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transferId, deleteToken, title, expiresSeconds, files: rawFiles } = body;

  if (!transferId || !deleteToken) {
    return NextResponse.json(
      { error: "Missing transferId or deleteToken" },
      { status: 400 }
    );
  }
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
    if (isHeifUploadLike(file)) {
      return NextResponse.json({ error: HEIF_TRANSFER_UPLOAD_ERROR }, { status: 400 });
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
  if (
    typeof expiresSeconds !== "number" ||
    expiresSeconds <= 0 ||
    expiresSeconds > MAX_EXPIRY_SECONDS
  ) {
    return NextResponse.json(
      { error: "Invalid expiresSeconds" },
      { status: 400 }
    );
  }

  try {
    const results = await mapWithConcurrency(
      files,
      FINALIZE_CONCURRENCY,
      async (file) => processUploadedFile(file, transferId)
    );
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };

    for (const result of results) {
      const k = result.file.kind;
      if (k === "image") counts.images++;
      else if (k === "gif") counts.gifs++;
      else if (k === "video") counts.videos++;
      else if (k === "audio") counts.audio++;
      else counts.other++;
    }

    const sortedFiles = sortTransferFiles(results.map((r) => r.file));
    const groupedTransfer = applyTransferAssetGroups(sortedFiles);
    const totalSize = results.reduce((sum, r) => sum + r.uploadedBytes, 0);
    const processingCounts = buildTransferProcessingCounts(groupedTransfer.files);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresSeconds * 1000);

    const transfer = {
      id: transferId,
      title: title || "untitled",
      files: groupedTransfer.files,
      groups: groupedTransfer.groups,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      deleteToken,
    };

    await saveTransfer(transfer, expiresSeconds);

    return NextResponse.json({
      shareUrl: `${BASE_URL}/t/${transferId}`,
      adminUrl: `${BASE_URL}/t/${transferId}?token=${deleteToken}`,
      transfer: {
        id: transferId,
        title: title || "untitled",
        fileCount: groupedTransfer.files.length,
        expiresAt: expiresAt.toISOString(),
      },
      totalSize,
      fileCounts: counts,
      processingCounts,
    });
  } catch (e) {
    return apiErrorFromRequest(
      request,
      "upload.finalize",
      "Failed to finalize transfer. Files were uploaded but metadata could not be saved.",
      e,
      { transferId, fileCount: files.length }
    );
  }
}
