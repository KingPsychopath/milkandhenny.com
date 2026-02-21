/**
 * Words media operations.
 *
 * Upload, list, and delete files stored under:
 * - words/media/{slug}/...   (word-scoped media)
 * - words/assets/{assetId}/... (shared asset library)
 *
 * For word-scoped media we still read/delete legacy blog/{slug}/ keys so
 * existing objects remain manageable.
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
} from "../features/media/processing";
import {
  mediaPrefixForTarget,
  toMarkdownSnippetForTarget,
  toR2Filename,
  type WordMediaTarget,
} from "../features/blog/upload";
import { formatBytes } from "../lib/shared/format";
import type { FileKind } from "../features/media/file-kinds";

/* ─── Constants ─── */

/** Sharp is CPU-heavy — limit concurrent image processing */
const IMAGE_CONCURRENCY = 3;
/** Raw uploads are purely network-bound — higher concurrency is fine */
const RAW_CONCURRENCY = 6;
const LEGACY_BLOG_PREFIX = "blog/";

/* ─── Types ─── */

type UploadedWordMediaFile = {
  original: string;
  filename: string;
  kind: FileKind;
  width?: number;
  height?: number;
  size: number;
  markdown: string;
  overwrote: boolean;
};

type UploadWordMediaResult = {
  uploaded: UploadedWordMediaFile[];
  skipped: string[];
  existing: WordMediaFileInfo[];
};

type WordMediaFileInfo = {
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

function legacyBlogPrefix(slug: string): string {
  return `${LEGACY_BLOG_PREFIX}${slug}/`;
}

function targetLabel(target: WordMediaTarget): string {
  return target.scope === "asset"
    ? `shared asset library (${target.assetId})`
    : `word media (${target.slug})`;
}

async function listTargetObjects(target: WordMediaTarget) {
  const primary = listObjects(mediaPrefixForTarget(target));
  if (target.scope === "asset") {
    return primary;
  }
  const legacy = listObjects(legacyBlogPrefix(target.slug));
  const [primaryObjects, legacyObjects] = await Promise.all([primary, legacy]);
  return [...primaryObjects, ...legacyObjects];
}

/* ─── Operations ─── */

async function uploadWordMediaFiles(
  target: WordMediaTarget,
  dir: string,
  opts?: { force?: boolean; onProgress?: (msg: string) => void }
): Promise<UploadWordMediaResult> {
  requireR2();

  const force = opts?.force ?? false;
  const onProgress = opts?.onProgress;

  const absDir = path.resolve(dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const files = fs
    .readdirSync(absDir)
    .filter((f) => !f.startsWith(".") && fs.statSync(path.join(absDir, f)).isFile())
    .sort();

  if (files.length === 0) {
    throw new Error(`No files found in ${absDir}`);
  }

  const existingObjects = await listTargetObjects(target);
  const existingInfo: WordMediaFileInfo[] = existingObjects.map((o) => ({
    key: o.key,
    filename: path.basename(o.key),
    size: o.size,
    lastModified: o.lastModified,
  }));
  const existingNames = new Set(existingInfo.map((i) => i.filename));

  if (existingInfo.length > 0) {
    onProgress?.(`${existingInfo.length} files already in R2 for ${targetLabel(target)}.`);
  }

  const images: { file: string; r2Filename: string; overwrites: boolean }[] = [];
  const rawFiles: { file: string; r2Filename: string; overwrites: boolean }[] = [];
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

  const parts: string[] = [];
  if (images.length > 0) parts.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
  if (rawFiles.length > 0) parts.push(`${rawFiles.length} other file${rawFiles.length > 1 ? "s" : ""}`);
  onProgress?.(`Uploading to ${targetLabel(target)}: ${parts.join(" + ")}...`);

  const imageResults = await mapConcurrent(
    images,
    IMAGE_CONCURRENCY,
    async ({ file, r2Filename, overwrites }): Promise<UploadedWordMediaFile> => {
      const raw = fs.readFileSync(path.join(absDir, file));
      const r2Key = `${mediaPrefixForTarget(target)}${r2Filename}`;

      onProgress?.(overwrites ? `Re-uploading ${r2Filename} (overwrite)...` : `Processing ${file}...`);

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
        markdown: toMarkdownSnippetForTarget(target, r2Filename, "image"),
        overwrote: overwrites,
      };
    }
  );

  const rawResults = await mapConcurrent(
    rawFiles,
    RAW_CONCURRENCY,
    async ({ file, r2Filename, overwrites }): Promise<UploadedWordMediaFile> => {
      const raw = fs.readFileSync(path.join(absDir, file));
      const mimeType = getMimeType(file);
      const kind = getFileKind(file);
      const r2Key = `${mediaPrefixForTarget(target)}${r2Filename}`;

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
        markdown: toMarkdownSnippetForTarget(target, r2Filename, kind),
        overwrote: overwrites,
      };
    }
  );

  return {
    uploaded: [...imageResults, ...rawResults],
    skipped,
    existing: existingInfo,
  };
}

async function listWordMediaFiles(target: WordMediaTarget): Promise<WordMediaFileInfo[]> {
  requireR2();

  const objects = await listTargetObjects(target);
  const primaryPrefix = mediaPrefixForTarget(target);
  const byFilename = new Map<string, WordMediaFileInfo>();

  for (const obj of objects) {
    const filename = path.basename(obj.key);
    const existing = byFilename.get(filename);
    const isPrimary = obj.key.startsWith(primaryPrefix);
    if (!existing || isPrimary) {
      byFilename.set(filename, {
        key: obj.key,
        filename,
        size: obj.size,
        lastModified: obj.lastModified,
      });
    }
  }

  return [...byFilename.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

async function deleteWordMediaFile(
  target: WordMediaTarget,
  filename: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  requireR2();

  const keys = [`${mediaPrefixForTarget(target)}${filename}`];
  if (target.scope === "word") {
    keys.push(`${legacyBlogPrefix(target.slug)}${filename}`);
  }

  onProgress?.(`Deleting ${keys[0]}${target.scope === "word" ? " (and legacy if present)" : ""}...`);
  await deleteObjects(keys);
  onProgress?.("Done.");
}

async function deleteAllWordMediaFiles(
  target: WordMediaTarget,
  onProgress?: (msg: string) => void
): Promise<number> {
  requireR2();

  const objects = await listTargetObjects(target);
  const keys = objects.map((o) => o.key);

  if (keys.length === 0) {
    onProgress?.(`No files found for ${targetLabel(target)}.`);
    return 0;
  }

  onProgress?.(`Deleting ${keys.length} files from ${targetLabel(target)}...`);
  const deleted = await deleteObjects(keys);
  onProgress?.("Done.");
  return deleted;
}

/* ─── Compatibility wrappers ─── */

async function uploadBlogFiles(
  slug: string,
  dir: string,
  opts?: { force?: boolean; onProgress?: (msg: string) => void }
): Promise<UploadWordMediaResult> {
  return uploadWordMediaFiles({ scope: "word", slug }, dir, opts);
}

async function listBlogFiles(slug: string): Promise<WordMediaFileInfo[]> {
  return listWordMediaFiles({ scope: "word", slug });
}

async function deleteBlogFile(
  slug: string,
  filename: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  return deleteWordMediaFile({ scope: "word", slug }, filename, onProgress);
}

async function deleteAllBlogFiles(
  slug: string,
  onProgress?: (msg: string) => void
): Promise<number> {
  return deleteAllWordMediaFiles({ scope: "word", slug }, onProgress);
}

export {
  uploadWordMediaFiles,
  listWordMediaFiles,
  deleteWordMediaFile,
  deleteAllWordMediaFiles,
  uploadBlogFiles,
  listBlogFiles,
  deleteBlogFile,
  deleteAllBlogFiles,
};

export type {
  UploadedWordMediaFile,
  UploadWordMediaResult,
  WordMediaFileInfo,
  WordMediaTarget,
};
