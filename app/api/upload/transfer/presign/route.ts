import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
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
import {
  getMimeType,
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
} from "@/features/media/processing";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isSafeTransferFilename } from "@/features/transfers/upload";
import path from "path";

type FileEntry = { name: string; size: number; type?: string };

function predictedTransferFileId(filename: string): string {
  if (PROCESSABLE_EXTENSIONS.test(filename) || ANIMATED_EXTENSIONS.test(filename)) {
    return path.basename(filename, path.extname(filename));
  }
  return filename;
}

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
  const authErr = await requireAuth(request, "upload");
  if (authErr) return authErr;

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

  const files = body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  let totalBytes = 0;
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
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
    if (seenNames.has(file.name)) {
      return NextResponse.json(
        { error: `Duplicate filename in upload selection: ${file.name}` },
        { status: 400 }
      );
    }
    seenNames.add(file.name);

    const predictedId = predictedTransferFileId(file.name);
    if (seenIds.has(predictedId)) {
      return NextResponse.json(
        { error: `Conflicting media filenames share the same transfer ID/stem: ${predictedId}` },
        { status: 400 }
      );
    }
    seenIds.add(predictedId);

    totalBytes += file.size;
    if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
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
        const contentType = getMimeType(file.name);
        const key = `transfers/${transferId}/original/${file.name}`;
        const url = await presignPutUrl(key, contentType);
        return { name: file.name, url };
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
