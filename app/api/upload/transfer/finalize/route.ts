import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/auth";
import {
  saveTransfer,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
} from "@/lib/transfers/store";
import {
  processUploadedFile,
  sortTransferFiles,
  isSafeTransferFilename,
} from "@/lib/transfers/upload";
import { BASE_URL } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/** Allow longer execution for image processing (downloads from R2 + Sharp) */
export const maxDuration = 60;

type FileEntry = { name: string; size: number; type?: string };

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
  const authErr = await requireAuth(request, "upload");
  if (authErr) return authErr;

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

  const { transferId, deleteToken, title, expiresSeconds, files } = body;

  if (!transferId || !deleteToken) {
    return NextResponse.json(
      { error: "Missing transferId or deleteToken" },
      { status: 400 }
    );
  }
  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  let totalBytes = 0;
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
    if (file.size > MAX_TRANSFER_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max 250MB per file." },
        { status: 400 }
      );
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
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
    const results = [];
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };

    // Process files sequentially to avoid memory pressure in serverless
    for (const file of files) {
      const result = await processUploadedFile(
        file.name,
        file.size,
        transferId
      );
      results.push(result);

      const k = result.file.kind;
      if (k === "image") counts.images++;
      else if (k === "gif") counts.gifs++;
      else if (k === "video") counts.videos++;
      else if (k === "audio") counts.audio++;
      else counts.other++;
    }

    const sortedFiles = sortTransferFiles(results.map((r) => r.file));
    const totalSize = results.reduce((sum, r) => sum + r.uploadedBytes, 0);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresSeconds * 1000);

    const transfer = {
      id: transferId,
      title: title || "untitled",
      files: sortedFiles,
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
        fileCount: sortedFiles.length,
        expiresAt: expiresAt.toISOString(),
      },
      totalSize,
      fileCounts: counts,
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
