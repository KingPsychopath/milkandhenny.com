import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithPayload } from "@/features/auth/server";
import { getTransfer, saveTransfer } from "@/features/transfers/store";
import { processUploadedFile, sortTransferFiles, isSafeTransferFilename } from "@/features/transfers/upload";
import { buildTransferProcessingCounts, getTransferFileId } from "@/features/transfers/media-state";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { BASE_URL } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

export const maxDuration = 60;
const FINALIZE_CONCURRENCY = 2;

type FileEntry = TransferUploadFileInput;

export async function POST(request: NextRequest) {
  const { error: authErr } = await requireAuthWithPayload(request, "admin");
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
  const existingArchivedNames = new Set(
    transfer.files.flatMap((f) => [f.filename, f.originalFilename].filter((value): value is string => typeof value === "string"))
  );
  const existingIds = new Set(transfer.files.map((f) => f.id));
  const seenNames = new Set<string>();
  const seenArchivedNames = new Set<string>();
  const seenIds = new Set<string>();

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

    const predictedId = getTransferFileId(file.name);
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

    const mergedFiles = sortTransferFiles([...transfer.files, ...results.map((r) => r.file)]);
    const updatedTransfer = { ...transfer, files: mergedFiles };
    await saveTransfer(updatedTransfer, remainingTtlSeconds);

    const totalSize = results.reduce((sum, r) => sum + r.uploadedBytes, 0);
    const processingCounts = buildTransferProcessingCounts(results.map((r) => r.file));

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
      processingCounts,
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
