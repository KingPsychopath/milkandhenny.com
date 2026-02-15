import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { uploadBuffer } from "@/scripts/r2-client";
import {
  saveTransfer,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  DEFAULT_EXPIRY_SECONDS,
} from "@/lib/transfers";
import type { TransferFile } from "@/lib/transfers";
import { BASE_URL } from "@/lib/config";
import {
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  getMimeType,
  getFileKind,
  processImageVariants,
  processGifThumb,
} from "@/scripts/media-processing";

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

  // Parse expiry
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
  const prefix = `transfers/${transferId}`;

  try {
    const transferFiles: TransferFile[] = [];
    let totalSize = 0;
    const counts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };

    // Process files sequentially to avoid memory pressure in serverless
    for (const file of rawFiles) {
      const filename = file.name;
      const ext = path.extname(filename).toLowerCase();
      const stem = path.basename(filename, ext);
      const buffer = Buffer.from(await file.arrayBuffer());

      if (PROCESSABLE_EXTENSIONS.test(filename)) {
        // Process image → thumb + full + original
        const processed = await processImageVariants(buffer, ext);
        const originalFilename =
          processed.original.ext === ext
            ? filename
            : `${stem}${processed.original.ext}`;

        await Promise.all([
          uploadBuffer(
            `${prefix}/thumb/${stem}.webp`,
            processed.thumb.buffer,
            processed.thumb.contentType
          ),
          uploadBuffer(
            `${prefix}/full/${stem}.webp`,
            processed.full.buffer,
            processed.full.contentType
          ),
          uploadBuffer(
            `${prefix}/original/${originalFilename}`,
            processed.original.buffer,
            processed.original.contentType
          ),
        ]);

        transferFiles.push({
          id: stem,
          filename: originalFilename,
          kind: "image",
          size: buffer.byteLength,
          mimeType: processed.original.contentType,
          width: processed.width,
          height: processed.height,
          ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
        });

        totalSize +=
          processed.thumb.buffer.byteLength +
          processed.full.buffer.byteLength +
          processed.original.buffer.byteLength;

        counts.images++;
      } else if (ANIMATED_EXTENSIONS.test(filename)) {
        // Process GIF → static thumb + original
        const gif = await processGifThumb(buffer);

        await Promise.all([
          uploadBuffer(
            `${prefix}/thumb/${stem}.webp`,
            gif.thumb.buffer,
            gif.thumb.contentType
          ),
          uploadBuffer(`${prefix}/original/${filename}`, buffer, "image/gif"),
        ]);

        transferFiles.push({
          id: stem,
          filename,
          kind: "gif",
          size: buffer.byteLength,
          mimeType: "image/gif",
          width: gif.width,
          height: gif.height,
        });

        totalSize += gif.thumb.buffer.byteLength + buffer.byteLength;
        counts.gifs++;
      } else {
        // Raw file — upload as-is
        const mimeType = getMimeType(filename);
        const kind = getFileKind(filename);

        await uploadBuffer(
          `${prefix}/original/${filename}`,
          buffer,
          mimeType
        );

        transferFiles.push({
          id: filename,
          filename,
          kind,
          size: buffer.byteLength,
          mimeType,
        });

        totalSize += buffer.byteLength;
        if (kind === "video") counts.videos++;
        else if (kind === "audio") counts.audio++;
        else counts.other++;
      }
    }

    // Sort: visual (images/gifs by EXIF date then name) then non-visual by name
    const visual = transferFiles.filter(
      (f) => f.kind === "image" || f.kind === "gif"
    );
    const nonVisual = transferFiles.filter(
      (f) => f.kind !== "image" && f.kind !== "gif"
    );
    visual.sort((a, b) => {
      if (a.takenAt && b.takenAt)
        return (
          new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
        );
      if (a.takenAt) return -1;
      if (b.takenAt) return 1;
      return a.filename.localeCompare(b.filename);
    });
    nonVisual.sort((a, b) => a.filename.localeCompare(b.filename));
    const sortedFiles = [...visual, ...nonVisual];

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
