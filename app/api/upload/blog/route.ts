import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { uploadBuffer, listObjects } from "@/scripts/r2-client";
import {
  isProcessableImage,
  getFileKind,
  getMimeType,
  processToWebP,
} from "@/scripts/media-processing";
import type { FileKind } from "@/lib/media/file-kinds";

/** Allow longer execution for image processing */
export const maxDuration = 60;

/* ─── Helpers ─── */

/** Sanitise a filename stem: lowercase, replace non-alphanumeric with hyphens */
function sanitiseStem(filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build the R2 filename — images become .webp, everything else keeps its extension */
function toR2Filename(localFilename: string): string {
  const sanitised = sanitiseStem(localFilename);
  if (isProcessableImage(localFilename)) {
    return `${sanitised}.webp`;
  }
  return `${sanitised}${path.extname(localFilename).toLowerCase()}`;
}

/** Generate a markdown snippet based on file kind */
function toMarkdownSnippet(
  slug: string,
  filename: string,
  kind: FileKind
): string {
  const r2Path = `blog/${slug}/${filename}`;
  const label = filename.replace(/\.[^.]+$/, "");

  switch (kind) {
    case "image":
    case "video":
    case "gif":
      return `![${label}](${r2Path})`;
    default:
      return `[${label}](${r2Path})`;
  }
}

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

/**
 * POST /api/upload/blog
 *
 * Upload files to blog/{slug}/ in R2.
 * Images are processed to WebP; everything else uploads raw.
 *
 * Authorization: PIN {pin}
 * Body: multipart/form-data with fields: slug, force?, files[]
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

  const slug = (formData.get("slug") as string)?.trim();
  const force = formData.get("force") === "true";
  const rawFiles = formData.getAll("files") as File[];

  if (!slug) {
    return NextResponse.json(
      { error: "Slug is required" },
      { status: 400 }
    );
  }

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  try {
    // Check what already exists in R2 for this slug
    const existingObjects = await listObjects(`blog/${slug}/`);
    const existingNames = new Set(
      existingObjects.map((o) => path.basename(o.key))
    );

    const uploaded: UploadedBlogFile[] = [];
    const skipped: string[] = [];

    // Process files sequentially to manage memory in serverless
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
    console.error("Blog upload failed:", e);
    return NextResponse.json(
      { error: `Upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
