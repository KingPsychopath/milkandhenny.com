import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { uploadBuffer, listObjects } from "@/lib/r2";
import {
  isProcessableImage,
  getFileKind,
  getMimeType,
  processToWebP,
} from "@/lib/media/processing";
import { toR2Filename, toMarkdownSnippet } from "@/lib/blog-upload";
import type { FileKind } from "@/lib/media/file-kinds";
import { apiError } from "@/lib/api-error";

/** Allow longer execution for image processing */
export const maxDuration = 60;

/* ─── Types ─── */

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
const MAX_BLOG_FILE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_BLOG_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB

/**
 * POST /api/upload/blog
 *
 * Upload files to blog/{slug}/ in R2.
 * Images are processed to WebP; everything else uploads raw.
 *
 * Authorization: Bearer {uploadJWT}
 * Body: multipart/form-data with fields: slug, force?, files[]
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "upload");
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

  const slug = (formData.get("slug") as string)?.trim();
  const force = formData.get("force") === "true";
  const rawFiles = formData.getAll("files") as File[];

  if (!slug) {
    return NextResponse.json(
      { error: "Slug is required" },
      { status: 400 }
    );
  }
  if (!SAFE_SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { error: "Slug must use lowercase letters, numbers, and hyphens only" },
      { status: 400 }
    );
  }

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (rawFiles.some((f) => !(f instanceof File))) {
    return NextResponse.json(
      { error: "Invalid files payload" },
      { status: 400 }
    );
  }
  let totalBytes = 0;
  for (const file of rawFiles) {
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

    const uploaded: UploadedBlogFile[] = [];
    const skipped: string[] = [];

    for (const file of rawFiles) {
      const r2Filename = toR2Filename(file.name);
      const alreadyExists = existingNames.has(r2Filename);

      if (alreadyExists && !force) {
        skipped.push(r2Filename);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const r2Key = `blog/${slug}/${r2Filename}`;

      if (isProcessableImage(file.name)) {
        const { buffer: webpBuffer, width, height } =
          await processToWebP(buffer);
        await uploadBuffer(r2Key, webpBuffer, "image/webp");

        uploaded.push({
          original: file.name,
          filename: r2Filename,
          kind: "image",
          width,
          height,
          size: webpBuffer.byteLength,
          markdown: toMarkdownSnippet(slug, r2Filename, "image"),
          overwrote: alreadyExists,
        });
      } else {
        const mimeType = getMimeType(file.name);
        const kind = getFileKind(file.name);

        await uploadBuffer(r2Key, buffer, mimeType);

        uploaded.push({
          original: file.name,
          filename: r2Filename,
          kind,
          size: buffer.byteLength,
          markdown: toMarkdownSnippet(slug, r2Filename, kind),
          overwrote: alreadyExists,
        });
      }
    }

    return NextResponse.json({ uploaded, skipped });
  } catch (e) {
    return apiError('upload.blog', 'Upload failed. Please try again.', e, { slug });
  }
}
