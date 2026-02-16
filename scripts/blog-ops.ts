/**
 * Blog media operations.
 *
 * Upload, list, and delete files stored under blog/{slug}/ in R2.
 * Unlike albums (which use a JSON manifest) or transfers (which use Redis),
 * blog media has no metadata store — the markdown file IS the manifest.
 *
 * Accepts any file type:
 * - Images (JPEG, PNG, WebP, HEIC, HIF, TIFF) → processed to WebP (max 1600px, quality 85)
 * - Everything else (video, audio, PDF, GIF, etc.) → uploaded raw, original format preserved
 *
 * R2 layout:
 *   blog/{slug}/{sanitised-name}.webp   — processed images
 *   blog/{slug}/{sanitised-name}.mp4    — raw files (original extension kept)
 */

import fs from "fs";
import path from "path";
import {
  uploadBuffer,
  deleteObjects,
  listObjects,
  isConfigured,
} from "./r2-client";
import {
  isProcessableImage,
  getFileKind,
  getMimeType,
  processToWebP,
  mapConcurrent,
} from "../lib/media/processing";
import { toR2Filename, toMarkdownSnippet } from "../lib/blog-upload";
import { formatBytes } from "../lib/format";
import type { FileKind } from "../lib/media/file-kinds";

/* ─── Constants ─── */

/** Sharp is CPU-heavy — limit concurrent image processing */
const IMAGE_CONCURRENCY = 3;
/** Raw uploads are purely network-bound — higher concurrency is fine */
const RAW_CONCURRENCY = 6;

/* ─── Types ─── */

type UploadedBlogFile = {
  /** Original filename (before processing) */
  original: string;
  /** Filename in R2 */
  filename: string;
  /** File kind (image, video, gif, audio, file) */
  kind: FileKind;
  /** Width after processing (images only) */
  width?: number;
  /** Height after processing (images only) */
  height?: number;
  /** Bytes uploaded */
  size: number;
  /** Ready-to-paste markdown snippet */
  markdown: string;
  /** Whether this was an overwrite of an existing file */
  overwrote: boolean;
};

type UploadBlogResult = {
  /** Newly uploaded files */
  uploaded: UploadedBlogFile[];
  /** Filenames that were skipped (already exist, no --force) */
  skipped: string[];
  /** Files that already existed before this upload */
  existing: BlogFileInfo[];
};

type BlogFileInfo = {
  key: string;
  filename: string;
  size: number;
  lastModified: Date | undefined;
};

/* ─── Preflight ─── */

function requireR2(): void {
  if (!isConfigured()) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET in .env.local."
    );
  }
}

/* ─── Operations ─── */

/**
 * Upload files from a local directory to blog/{slug}/ in R2.
 * Images are processed to WebP; everything else uploads raw.
 *
 * Supports incremental uploads: duplicates (by sanitised filename)
 * are skipped by default. Pass force=true to overwrite.
 *
 * Returns the full picture: what was uploaded, what was skipped,
 * and what was already in R2 before this run.
 */
async function uploadBlogFiles(
  slug: string,
  dir: string,
  opts?: { force?: boolean; onProgress?: (msg: string) => void }
): Promise<UploadBlogResult> {
  requireR2();

  const force = opts?.force ?? false;
  const onProgress = opts?.onProgress;

  const absDir = path.resolve(dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  // Accept ALL non-hidden files (same as transfers)
  const files = fs
    .readdirSync(absDir)
    .filter(
      (f) => !f.startsWith(".") && fs.statSync(path.join(absDir, f)).isFile()
    )
    .sort();

  if (files.length === 0) {
    throw new Error(`No files found in ${absDir}`);
  }

  // Check what's already in R2 for this post
  const existingObjects = await listObjects(`blog/${slug}/`);
  const existingInfo: BlogFileInfo[] = existingObjects.map((o) => ({
    key: o.key,
    filename: path.basename(o.key),
    size: o.size,
    lastModified: o.lastModified,
  }));
  const existingNames = new Set(existingInfo.map((i) => i.filename));

  if (existingInfo.length > 0) {
    onProgress?.(
      `${existingInfo.length} files already in R2 for "${slug}".`
    );
  }

  // Classify and separate new vs duplicate
  const images: { file: string; r2Filename: string; overwrites: boolean }[] =
    [];
  const rawFiles: { file: string; r2Filename: string; overwrites: boolean }[] =
    [];
  const skipped: string[] = [];

  for (const file of files) {
    const r2Filename = toR2Filename(file);
    const alreadyExists = existingNames.has(r2Filename);

    if (alreadyExists && !force) {
      skipped.push(r2Filename);
      onProgress?.(`Skipping ${file} → ${r2Filename} (already exists)`);
      continue;
    }

    const entry = { file, r2Filename, overwrites: alreadyExists };
    if (isProcessableImage(file)) {
      images.push(entry);
    } else {
      rawFiles.push(entry);
    }
  }

  const totalNew = images.length + rawFiles.length;
  if (totalNew === 0) {
    onProgress?.("All files already uploaded. Nothing new to process.");
    return { uploaded: [], skipped, existing: existingInfo };
  }

  // Summarise what's about to happen
  const parts: string[] = [];
  if (images.length > 0)
    parts.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
  if (rawFiles.length > 0)
    parts.push(
      `${rawFiles.length} other file${rawFiles.length > 1 ? "s" : ""}`
    );
  onProgress?.(`Uploading ${parts.join(" + ")}...`);

  // Process images (Sharp → WebP)
  const imageResults = await mapConcurrent(
    images,
    IMAGE_CONCURRENCY,
    async ({ file, r2Filename, overwrites }): Promise<UploadedBlogFile> => {
      const raw = fs.readFileSync(path.join(absDir, file));
      const r2Key = `blog/${slug}/${r2Filename}`;

      onProgress?.(
        overwrites
          ? `Re-uploading ${r2Filename} (overwrite)...`
          : `Processing ${file}...`
      );

      const { buffer, width, height } = await processToWebP(raw);
      await uploadBuffer(r2Key, buffer, "image/webp");
      onProgress?.(`Uploaded ${r2Filename} (${width}×${height})`);

      return {
        original: file,
        filename: r2Filename,
        kind: "image",
        width,
        height,
        size: buffer.byteLength,
        markdown: toMarkdownSnippet(slug, r2Filename, "image"),
        overwrote: overwrites,
      };
    }
  );

  // Upload raw files (video, audio, PDF, GIF, etc.) — no processing
  const rawResults = await mapConcurrent(
    rawFiles,
    RAW_CONCURRENCY,
    async ({ file, r2Filename, overwrites }): Promise<UploadedBlogFile> => {
      const raw = fs.readFileSync(path.join(absDir, file));
      const mimeType = getMimeType(file);
      const kind = getFileKind(file);
      const r2Key = `blog/${slug}/${r2Filename}`;

      onProgress?.(
        overwrites
          ? `Re-uploading ${r2Filename} (overwrite)...`
          : `Uploading ${file} (${formatBytes(raw.byteLength)}, ${kind})...`
      );

      await uploadBuffer(r2Key, raw, mimeType);
      onProgress?.(`Uploaded ${r2Filename}`);

      return {
        original: file,
        filename: r2Filename,
        kind,
        size: raw.byteLength,
        markdown: toMarkdownSnippet(slug, r2Filename, kind),
        overwrote: overwrites,
      };
    }
  );

  const uploaded = [...imageResults, ...rawResults];
  return { uploaded, skipped, existing: existingInfo };
}

/**
 * List all blog files for a given post slug.
 */
async function listBlogFiles(slug: string): Promise<BlogFileInfo[]> {
  requireR2();

  const objects = await listObjects(`blog/${slug}/`);
  return objects.map((o) => ({
    key: o.key,
    filename: path.basename(o.key),
    size: o.size,
    lastModified: o.lastModified,
  }));
}

/**
 * Delete a single blog file by filename.
 */
async function deleteBlogFile(
  slug: string,
  filename: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  requireR2();

  const key = `blog/${slug}/${filename}`;
  onProgress?.(`Deleting ${key}...`);
  await deleteObjects([key]);
  onProgress?.("Done.");
}

/**
 * Delete ALL blog files for a post slug.
 * Returns the number of files deleted.
 */
async function deleteAllBlogFiles(
  slug: string,
  onProgress?: (msg: string) => void
): Promise<number> {
  requireR2();

  const objects = await listObjects(`blog/${slug}/`);
  const keys = objects.map((o) => o.key);

  if (keys.length === 0) {
    onProgress?.("No blog files found for this post.");
    return 0;
  }

  onProgress?.(`Deleting ${keys.length} files from blog/${slug}/...`);
  const deleted = await deleteObjects(keys);
  onProgress?.("Done.");
  return deleted;
}

export {
  uploadBlogFiles,
  listBlogFiles,
  deleteBlogFile,
  deleteAllBlogFiles,
};

export type { UploadedBlogFile, UploadBlogResult, BlogFileInfo };
