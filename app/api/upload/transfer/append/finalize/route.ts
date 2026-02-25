import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getTransfer, saveTransfer, MAX_TRANSFER_FILE_BYTES, MAX_TRANSFER_TOTAL_BYTES } from "@/features/transfers/store";
import { processUploadedFile, sortTransferFiles, isSafeTransferFilename } from "@/features/transfers/upload";
import { PROCESSABLE_EXTENSIONS, ANIMATED_EXTENSIONS } from "@/features/media/processing";
import { BASE_URL } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import path from "path";

export const maxDuration = 60;

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
    const results = [];
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };

    for (const file of files) {
      const result = await processUploadedFile(file.name, file.size, transferId);
      results.push(result);
      const k = result.file.kind;
      if (k === "image") counts.images++;
      else if (k === "gif") counts.gifs++;
      else if (k === "video") counts.videos++;
      else if (k === "audio") counts.audio++;
      else counts.other++;
    }

    const mergedFiles = sortTransferFiles([...transfer.files, ...results.map((r) => r.file)]);
    const updatedTransfer = { ...transfer, files: mergedFiles };
    await saveTransfer(updatedTransfer, remainingTtlSeconds);

    const totalSize = results.reduce((sum, r) => sum + r.uploadedBytes, 0);

    return NextResponse.json({
      shareUrl: `${BASE_URL}/t/${transferId}`,
      adminUrl: `${BASE_URL}/t/${transferId}?token=${transfer.deleteToken}`,
      transfer: {
        id: transferId,
        title: transfer.title,
        fileCount: mergedFiles.length,
        expiresAt: transfer.expiresAt,
      },
      addedCount: results.length,
      totalSize,
      fileCounts: counts,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.transfer.append.finalize",
      "Append upload succeeded but finalization failed.",
      error,
      { transferId, fileCount: files.length }
    );
  }
}
