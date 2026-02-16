import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { deleteObject, downloadBuffer, isConfigured, uploadBuffer } from "@/lib/platform/r2";
import { isProcessableImage, processToWebP } from "@/features/media/processing";
import { toMarkdownSnippet } from "@/features/blog/upload";
import { getFileKind } from "@/features/media/processing";
import type { FileKind } from "@/features/media/file-kinds";

/** Allow longer execution for image processing */
export const maxDuration = 60;

type FinalizeFile = {
  original: string;
  filename: string;
  uploadKey: string;
  size: number;
  kind: FileKind;
  overwrote: boolean;
};

type UploadedBlogFile = {
  original: string;
  filename: string;
  kind: FileKind;
  width?: number;
  height?: number;
  size: number;
  markdown: string;
  overwrote: boolean;
};

const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/;
const SAFE_BLOG_FILENAME = /^[a-z0-9-]+\.[a-z0-9]{1,8}$/;

function isSafeUploadKey(slug: string, uploadKey: string): boolean {
  if (!uploadKey.startsWith(`blog/${slug}/`)) return false;
  if (uploadKey.includes("..")) return false;
  return true;
}

/**
 * POST /api/upload/blog/finalize
 *
 * Step 2 of the blog presigned upload flow.
 * Images are downloaded from R2, converted to WebP, and saved to blog/{slug}/{filename}.
 * Non-images were uploaded directly to their final key and are just reported back.
 *
 * Body: { slug, files: FinalizeFile[], skipped?: string[] }
 * Returns: { uploaded: UploadedBlogFile[], skipped: string[] }
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 }
    );
  }

  let body: { slug?: string; files?: FinalizeFile[]; skipped?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  const files = body.files;
  const skipped = Array.isArray(body.skipped) ? body.skipped.filter((s) => typeof s === "string") : [];

  if (!slug) return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  if (!SAFE_SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { error: "Slug must use lowercase letters, numbers, and hyphens only" },
      { status: 400 }
    );
  }

  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  for (const file of files) {
    if (!file || typeof file.original !== "string" || !file.original.trim()) {
      return NextResponse.json({ error: "Each file must include original" }, { status: 400 });
    }
    if (!file.filename || typeof file.filename !== "string" || !SAFE_BLOG_FILENAME.test(file.filename)) {
      return NextResponse.json({ error: "Each file must include a safe filename" }, { status: 400 });
    }
    if (!file.uploadKey || typeof file.uploadKey !== "string" || !isSafeUploadKey(slug, file.uploadKey)) {
      return NextResponse.json({ error: "Each file must include a safe uploadKey" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json({ error: "Each file must include a valid size" }, { status: 400 });
    }
  }

  try {
    const uploaded: UploadedBlogFile[] = [];

    for (const file of files) {
      const original = file.original.trim();
      const finalKey = `blog/${slug}/${file.filename}`;

      if (isProcessableImage(original)) {
        // Uploaded to a temp key → download → process → upload to final key → delete temp key.
        const raw = await downloadBuffer(file.uploadKey);
        const { buffer: webpBuffer, width, height } = await processToWebP(raw);
        await uploadBuffer(finalKey, webpBuffer, "image/webp");

        try {
          await deleteObject(file.uploadKey);
        } catch {
          // Best-effort cleanup. The temp file is not referenced by markdown and can be cleaned manually.
        }

        uploaded.push({
          original,
          filename: file.filename,
          kind: "image",
          width,
          height,
          size: webpBuffer.byteLength,
          markdown: toMarkdownSnippet(slug, file.filename, "image"),
          overwrote: !!file.overwrote,
        });
      } else {
        // Already uploaded directly to finalKey.
        const kind = file.kind ?? getFileKind(original);
        uploaded.push({
          original,
          filename: file.filename,
          kind,
          size: file.size,
          markdown: toMarkdownSnippet(slug, file.filename, kind),
          overwrote: !!file.overwrote,
        });
      }
    }

    return NextResponse.json({ uploaded, skipped });
  } catch (e) {
    return apiErrorFromRequest(
      request,
      "upload.blog.finalize",
      "Failed to finalize blog upload. Files may have uploaded but could not be processed.",
      e,
      { slug }
    );
  }
}

