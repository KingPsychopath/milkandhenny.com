import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getTransfer, MAX_TRANSFER_FILE_BYTES, MAX_TRANSFER_TOTAL_BYTES } from "@/features/transfers/store";
import { isSafeTransferFilename } from "@/features/transfers/upload";
import { presignPutUrl, isConfigured } from "@/lib/platform/r2";
import { getMimeType, PROCESSABLE_EXTENSIONS, ANIMATED_EXTENSIONS } from "@/features/media/processing";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import path from "path";

type FileEntry = { name: string; size: number; type?: string };

function predictedTransferFileId(filename: string): string {
  if (PROCESSABLE_EXTENSIONS.test(filename) || ANIMATED_EXTENSIONS.test(filename)) {
    return path.basename(filename, path.extname(filename));
  }
  return filename;
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
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
  const files = body.files;
  if (!transferId) {
    return NextResponse.json({ error: "Missing transferId" }, { status: 400 });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const transfer = await getTransfer(transferId);
  if (!transfer) {
    return NextResponse.json({ error: "Transfer not found or expired" }, { status: 404 });
  }

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000
  );
  if (remainingTtlSeconds <= 0) {
    return NextResponse.json({ error: "Transfer has already expired" }, { status: 400 });
  }

  const existingNames = new Set(transfer.files.map((f) => f.filename));
  const existingIds = new Set(transfer.files.map((f) => f.id));
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  let totalBytes = 0;

  for (const file of files) {
    if (!file || typeof file.name !== "string" || !isSafeTransferFilename(file.name)) {
      return NextResponse.json({ error: "Each file must have a safe filename" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json({ error: "Each file must include a valid non-negative size" }, { status: 400 });
    }
    if (file.size > MAX_TRANSFER_FILE_BYTES) {
      return NextResponse.json({ error: "File too large. Max 250MB per file." }, { status: 400 });
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
      return NextResponse.json({ error: "Transfer append too large. Max 1GB total per append request." }, { status: 400 });
    }
    if (seenNames.has(file.name)) {
      return NextResponse.json({ error: `Duplicate filename in upload selection: ${file.name}` }, { status: 400 });
    }
    if (existingNames.has(file.name)) {
      return NextResponse.json({ error: `Filename already exists in transfer: ${file.name}` }, { status: 400 });
    }
    seenNames.add(file.name);

    const predictedId = predictedTransferFileId(file.name);
    if (seenIds.has(predictedId)) {
      return NextResponse.json(
        { error: `Conflicting media filenames share the same transfer ID/stem: ${predictedId}` },
        { status: 400 }
      );
    }
    if (existingIds.has(predictedId)) {
      return NextResponse.json(
        { error: `Media ID/stem already exists in transfer: ${predictedId}` },
        { status: 400 }
      );
    }
    seenIds.add(predictedId);
  }

  try {
    const urls = await Promise.all(
      files.map(async (file) => {
        const contentType = getMimeType(file.name);
        const key = `transfers/${transferId}/original/${file.name}`;
        const url = await presignPutUrl(key, contentType);
        return { name: file.name, url };
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
