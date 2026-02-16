import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { presignPutUrl, isConfigured, listObjects } from "@/lib/platform/r2";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getMimeType, isProcessableImage } from "@/features/media/processing";
import { sanitiseStem, toR2Filename } from "@/features/blog/upload";
import { getFileKind } from "@/features/media/processing";
import type { FileKind } from "@/features/media/file-kinds";
import { randomUUID } from "crypto";
import path from "path";

type FileEntry = { name: string; size: number; type?: string };

type PresignEntry = {
  original: string;
  /** Final filename in blog/{slug}/ */
  filename: string;
  /** Where the browser PUTs the bytes */
  uploadKey: string;
  /** One-time presigned PUT URL */
  url: string;
  /** File kind based on the original extension */
  kind: FileKind;
  /** True if a file with this final name already existed */
  overwrote: boolean;
};

const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/;
const SAFE_BLOG_FILENAME = /^[a-z0-9-]+\.[a-z0-9]{1,8}$/;
const MAX_BLOG_FILE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_BLOG_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB

function safeIncomingExt(original: string): string {
  const ext = path.extname(original).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
}

/**
 * POST /api/upload/blog/presign
 *
 * Step 1 of the blog presigned upload flow.
 * Returns presigned PUT URLs so the browser can upload direct to R2.
 *
 * Body: { slug, force?, files: [{ name, size, type? }] }
 * Returns: { success: true, urls: PresignEntry[], skipped: string[] }
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

  let body: { slug?: string; force?: boolean; files?: FileEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  const force = !!body.force;
  const files = body.files;

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

  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !file.name.trim()) {
      return NextResponse.json({ error: "Each file must include a name" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return NextResponse.json({ error: "Each file must include a valid size" }, { status: 400 });
    }
    if (file.size > MAX_BLOG_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max 50MB per file." },
        { status: 400 }
      );
    }
    totalBytes += file.size;
    if (totalBytes > MAX_BLOG_TOTAL_BYTES) {
      return NextResponse.json(
        { error: "Upload too large. Max 500MB total." },
        { status: 400 }
      );
    }
  }

  try {
    const existingObjects = await listObjects(`blog/${slug}/`);
    const existingNames = new Set(
      existingObjects.map((o) => {
        const parts = o.key.split("/");
        return parts[parts.length - 1];
      })
    );

    const urls: PresignEntry[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const original = file.name.trim();
      const filename = toR2Filename(original);

      if (!SAFE_BLOG_FILENAME.test(filename)) {
        return NextResponse.json(
          { error: `Unsafe filename derived from "${original}"` },
          { status: 400 }
        );
      }

      const alreadyExists = existingNames.has(filename);
      if (alreadyExists && !force) {
        skipped.push(filename);
        continue;
      }

      const isImage = isProcessableImage(original);
      const kind: FileKind = isImage ? "image" : getFileKind(original);
      const contentType = getMimeType(original);

      // Images are uploaded to a temp key, then converted to WebP in finalize.
      // Raw files are uploaded directly to their final key (no finalize work needed).
      const uploadKey = isImage
        ? `blog/${slug}/incoming/${randomUUID()}-${sanitiseStem(original)}${safeIncomingExt(original)}`
        : `blog/${slug}/${filename}`;

      const url = await presignPutUrl(uploadKey, contentType);

      urls.push({
        original,
        filename,
        uploadKey,
        url,
        kind,
        overwrote: alreadyExists,
      });
    }

    return NextResponse.json({ success: true, urls, skipped });
  } catch (e) {
    return apiErrorFromRequest(
      request,
      "upload.blog.presign",
      "Failed to generate upload URLs. Please try again.",
      e,
      { slug }
    );
  }
}

