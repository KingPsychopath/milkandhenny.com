import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  saveTransfer,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
} from "@/lib/transfers";
import { processTransferFile, sortTransferFiles } from "@/lib/transfer-upload";
import { BASE_URL } from "@/lib/config";

/** Allow longer execution for image processing */
export const maxDuration = 60;

/**
 * POST /api/upload/transfer
 *
 * Create a new ephemeral transfer from uploaded files.
 * Authorization: PIN {pin}
 * Body: multipart/form-data with fields: title, expires, files[]
 */
export async function POST(request: NextRequest) {
  const authErr = requireAuth(request, "upload");
  if (authErr) return authErr;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data" },
      { status: 400 }
    );
  }

  const title = (formData.get("title") as string) || "untitled";
  const expiresRaw = (formData.get("expires") as string) || "";
  const rawFiles = formData.getAll("files") as File[];

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  let ttlSeconds = DEFAULT_EXPIRY_SECONDS;
  if (expiresRaw) {
    try {
      ttlSeconds = parseExpiry(expiresRaw);
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
    const results = [];
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };

    // Process files sequentially to avoid memory pressure in serverless
    for (const file of rawFiles) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await processTransferFile(buffer, file.name, transferId);
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
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const transfer = {
      id: transferId,
      title,
      files: sortedFiles,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      deleteToken,
    };

    await saveTransfer(transfer, ttlSeconds);

    return NextResponse.json({
      shareUrl: `${BASE_URL}/t/${transferId}`,
      adminUrl: `${BASE_URL}/t/${transferId}?token=${deleteToken}`,
      transfer: {
        id: transferId,
        title,
        fileCount: sortedFiles.length,
        expiresAt: expiresAt.toISOString(),
      },
      totalSize,
      fileCounts: counts,
    });
  } catch (e) {
    console.error("Transfer upload failed:", e);
    return NextResponse.json(
      { error: `Upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
