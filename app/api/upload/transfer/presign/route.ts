import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { presignPutUrl, isConfigured } from "@/lib/r2";
import {
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
} from "@/lib/transfers";
import { getMimeType } from "@/lib/media/processing";
import { apiError } from "@/lib/api-error";
import { isSafeTransferFilename } from "@/lib/transfer-upload";

type FileEntry = { name: string; size: number; type?: string };
const MAX_TRANSFER_FILE_BYTES = 250 * 1024 * 1024; // 250MB
const MAX_TRANSFER_TOTAL_BYTES = 1024 * 1024 * 1024; // 1GB

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
  const authErr = requireAuth(request, "upload");
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
    return apiError(
      "upload.presign",
      "Failed to generate upload URLs. Please try again.",
      e,
      { transferId, fileCount: files.length }
    );
  }
}
