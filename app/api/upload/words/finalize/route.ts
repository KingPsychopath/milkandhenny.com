import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithPayload } from "@/features/auth/server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { deleteObject, downloadBuffer, isConfigured, uploadBuffer } from "@/lib/platform/r2";
import {
  RawPreviewUnavailableError,
  getMimeType,
  isProcessableImage,
  processToWebP,
} from "@/features/media/processing";
import {
  isRawWordUpload,
  mediaPathForTarget,
  mediaPrefixForTarget,
  parseWordMediaTarget,
  toR2Filename,
  toMarkdownSnippetForTarget,
} from "@/features/words/upload";
import { getFileKind } from "@/features/media/processing";
import type { FileKind } from "@/features/media/file-kinds";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";
import { enqueueWordMediaJob } from "@/features/words/media-queue";

/** Keep finalize short; deterministic image processing is queued for the worker. */
export const maxDuration = 15;
const FINALIZE_CONCURRENCY = 2;

type FinalizeFile = {
  original: string;
  filename: string;
  uploadKey: string;
  size: number;
  kind: FileKind;
  overwrote: boolean;
};

type FinalizeSuccess = {
  uploaded: Array<{
    original: string;
    filename: string;
    kind: FileKind;
    width?: number;
    height?: number;
    size: number;
    markdown: string;
    overwrote: boolean;
  }>;
  skipped: string[];
  queuedCount: number;
};

const SAFE_WORD_FILENAME = /^[a-z0-9-]+\.[a-z0-9]{1,8}$/;
function isSafeUploadKey(targetPrefix: string, uploadKey: string): boolean {
  if (!uploadKey.startsWith(targetPrefix)) {
    return false;
  }
  if (uploadKey.includes("..")) return false;
  return true;
}

/**
 * POST /api/upload/words/finalize
 *
 * Step 2 of the words media presigned upload flow.
 * Images are downloaded from R2, converted to WebP, and saved to the final target path.
 * Non-images were uploaded directly to their final key and are just reported back.
 *
 * Body: { scope?: "word"|"asset", slug?, assetId?, files: FinalizeFile[], skipped?: string[] }
 * Returns: { uploaded: UploadedWordFile[], skipped: string[] }
 */
export async function POST(request: NextRequest) {
  const { error: authErr } = await requireAuthWithPayload(request, "admin");
  if (authErr) return authErr;

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 }
    );
  }

  let body: {
    scope?: string;
    slug?: string;
    assetId?: string;
    files?: FinalizeFile[];
    skipped?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetResult = parseWordMediaTarget({
    scope: body.scope,
    slug: body.slug,
    assetId: body.assetId,
  });
  if (!targetResult.ok) {
    return NextResponse.json({ error: targetResult.error }, { status: 400 });
  }
  const target = targetResult.target;
  const targetPrefix = mediaPrefixForTarget(target);
  const files = body.files;
  const skipped = Array.isArray(body.skipped) ? body.skipped.filter((s) => typeof s === "string") : [];

  if (!Array.isArray(files)) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ uploaded: [], skipped });
  }

  for (const file of files) {
    if (!file || typeof file.original !== "string" || !file.original.trim()) {
      return NextResponse.json({ error: "Each file must include original" }, { status: 400 });
    }
    if (!file.filename || typeof file.filename !== "string" || !SAFE_WORD_FILENAME.test(file.filename)) {
      return NextResponse.json({ error: "Each file must include a safe filename" }, { status: 400 });
    }
    if (
      !file.uploadKey ||
      typeof file.uploadKey !== "string" ||
      !isSafeUploadKey(targetPrefix, file.uploadKey)
    ) {
      return NextResponse.json({ error: "Each file must include a safe uploadKey" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json({ error: "Each file must include a valid size" }, { status: 400 });
    }
  }

  try {
    let queuedCount = 0;
    const uploaded = await mapWithConcurrency(files, FINALIZE_CONCURRENCY, async (file) => {
      const original = file.original.trim();

      if (isProcessableImage(original)) {
        if (!isRawWordUpload(original)) {
          const webpFilename = toR2Filename(original);
          await enqueueWordMediaJob({
            target,
            original,
            uploadKey: file.uploadKey,
            finalFilename: webpFilename,
            size: file.size,
            overwrote: !!file.overwrote,
            enqueuedAt: new Date().toISOString(),
          });
          queuedCount += 1;

          return {
            original,
            filename: webpFilename,
            kind: "image" as const,
            size: file.size,
            markdown: toMarkdownSnippetForTarget(target, webpFilename, "image"),
            overwrote: !!file.overwrote,
          };
        }

        // Uploaded to a temp key → download → process → upload to final key → delete temp key.
        const raw = await downloadBuffer(file.uploadKey);
        const webpFilename = toR2Filename(original);
        const webpKey = mediaPathForTarget(target, webpFilename);

        try {
          const { buffer: webpBuffer, width, height } = await processToWebP(raw, original);
          await uploadBuffer(webpKey, webpBuffer, "image/webp");

          try {
            await deleteObject(file.uploadKey);
          } catch {
            // Best-effort cleanup. The temp file is not referenced by markdown and can be cleaned manually.
          }

          return {
            original,
            filename: webpFilename,
            kind: "image" as const,
            width,
            height,
            size: webpBuffer.byteLength,
            markdown: toMarkdownSnippetForTarget(target, webpFilename, "image"),
            overwrote: !!file.overwrote,
          };
        } catch (error) {
          if (!(error instanceof RawPreviewUnavailableError) || !isRawWordUpload(original)) {
            throw error;
          }

          const fallbackFilename = toR2Filename(original, { preserveRawExtension: true });
          const fallbackKey = mediaPathForTarget(target, fallbackFilename);
          const fallbackKind: FileKind = "file";
          await uploadBuffer(fallbackKey, raw, getMimeType(original));

          try {
            await deleteObject(file.uploadKey);
          } catch {
            // Best-effort cleanup. The temp file is not referenced by markdown and can be cleaned manually.
          }

          return {
            original,
            filename: fallbackFilename,
            kind: fallbackKind,
            size: raw.byteLength,
            markdown: toMarkdownSnippetForTarget(target, fallbackFilename, fallbackKind),
            overwrote: !!file.overwrote,
          };
        }
      }

      // Already uploaded directly to finalKey.
      const kind = file.kind ?? getFileKind(original);
      return {
        original,
        filename: file.filename,
        kind,
        size: file.size,
        markdown: toMarkdownSnippetForTarget(target, file.filename, kind),
        overwrote: !!file.overwrote,
      };
    });

    const payload: FinalizeSuccess = { uploaded, skipped, queuedCount };
    return NextResponse.json(payload);
  } catch (e) {
    const incomingKeys = files
      .map((file) => file.uploadKey)
      .filter(
        (key): key is string =>
          typeof key === "string" &&
          key.includes("/incoming/") &&
          isSafeUploadKey(targetPrefix, key)
      );
    await Promise.all(
      incomingKeys.map(async (key) => {
        try {
          await deleteObject(key);
        } catch {
          // Best-effort temp cleanup after finalize failure.
        }
      })
    );

    return apiErrorFromRequest(
      request,
      "upload.words.finalize",
      "Failed to finalize words upload. Files may have uploaded but could not be processed.",
      e
    );
  }
}
