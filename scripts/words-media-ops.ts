/**
 * Words media operations.
 *
 * Upload, list, and delete files stored under:
 * - words/media/{slug}/...   (word-scoped media)
 * - words/assets/{assetId}/... (shared asset library)
 */

import fs from "fs";
import path from "path";
import {
  uploadBuffer,
  deleteObjects,
  listObjects,
  isConfigured,
  downloadBuffer,
  setObjectHttpMetadata,
} from "./r2-client";
import {
  isProcessableImage,
  getFileKind,
  getMimeType,
  processResponsiveImage,
  mapConcurrent,
} from "../features/media/processing.server";
import {
  mediaPrefixForTarget,
  parseWordMediaTarget,
  toMarkdownSnippetForTarget,
  toR2Filename,
  type WordMediaTarget,
} from "../features/words/upload";
import {
  mergeWordImageMetadata,
  pruneWordImageVariants,
  readWordImageManifest,
  writeWordImageManifest,
} from "../features/words/image.server";
import {
  isWordImageInternalKey,
  parseWordImageLocation,
  wordImageVariantKey,
} from "../features/words/image";
import { getWordMediaStorageScope } from "../features/words/media-storage.server";
import type { ResponsiveImageMetadata } from "../features/media/image";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "../lib/shared/media-cache";
import {
  cleanupOrphanWordMediaFolders,
  scanOrphanWordMediaFolders,
  type WordMediaOrphanCleanupResult,
  type WordMediaOrphanSummary,
} from "../features/words/media-maintenance";
import { formatBytes } from "../lib/shared/format";
import type { FileKind } from "../features/media/file-kinds";

/* ─── Constants ─── */

/** Sharp is CPU-heavy — limit concurrent image processing */
const IMAGE_CONCURRENCY = 3;
/** Raw uploads are purely network-bound — higher concurrency is fine */
const RAW_CONCURRENCY = 6;
const WORDS_MEDIA_UPLOAD_CHECKPOINT_PREFIX = ".mah-words-media-upload.";
const WORDS_MEDIA_UPLOAD_CHECKPOINT_SUFFIX = ".checkpoint.json";

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
  image?: ResponsiveImageMetadata;
};

type UploadWordMediaResult = {
  uploaded: UploadedWordMediaFile[];
  skipped: string[];
  existing: WordMediaFileInfo[];
};

type WordMediaUploadPlanEntry = {
  file: string;
  r2Filename: string;
  overwrites: boolean;
  lane: "image" | "raw";
};

type WordMediaUploadCheckpoint = {
  version: 1;
  dir: string;
  target: WordMediaTarget;
  force: boolean;
  files: string[];
  skipped: string[];
  uploads: WordMediaUploadPlanEntry[];
  completed: Record<string, UploadedWordMediaFile>;
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
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, and R2_PUBLIC_BUCKET in .env.local.",
    );
  }
}

function targetLabel(target: WordMediaTarget): string {
  return target.scope === "asset"
    ? `shared asset library (${target.assetId})`
    : `word media (${target.slug})`;
}

function checkpointTargetKey(target: WordMediaTarget): string {
  return target.scope === "asset" ? `asset.${target.assetId}` : `word.${target.slug}`;
}

function getWordMediaUploadCheckpointFilename(target: WordMediaTarget): string {
  return `${WORDS_MEDIA_UPLOAD_CHECKPOINT_PREFIX}${checkpointTargetKey(target)}${WORDS_MEDIA_UPLOAD_CHECKPOINT_SUFFIX}`;
}

function getWordMediaUploadCheckpointPath(absDir: string, target: WordMediaTarget): string {
  return path.join(absDir, getWordMediaUploadCheckpointFilename(target));
}

function writeWordMediaUploadCheckpoint(
  absDir: string,
  target: WordMediaTarget,
  checkpoint: WordMediaUploadCheckpoint,
): void {
  const file = getWordMediaUploadCheckpointPath(absDir, target);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function deleteWordMediaUploadCheckpoint(absDir: string, target: WordMediaTarget): void {
  const file = getWordMediaUploadCheckpointPath(absDir, target);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function sameWordMediaTarget(a: WordMediaTarget, b: WordMediaTarget): boolean {
  return (
    a.scope === b.scope &&
    (a.scope === "asset"
      ? a.assetId === (b as { assetId: string }).assetId
      : a.slug === (b as { slug: string }).slug)
  );
}

function readWordMediaUploadCheckpoint(
  absDir: string,
  target: WordMediaTarget,
): WordMediaUploadCheckpoint | null {
  const file = getWordMediaUploadCheckpointPath(absDir, target);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Partial<WordMediaUploadCheckpoint> & {
    target?: { scope?: string; slug?: string; assetId?: string };
  };

  if (
    parsed.version !== 1 ||
    typeof parsed.dir !== "string" ||
    typeof parsed.force !== "boolean" ||
    !Array.isArray(parsed.files) ||
    !Array.isArray(parsed.skipped) ||
    !Array.isArray(parsed.uploads) ||
    !parsed.completed ||
    typeof parsed.completed !== "object" ||
    !parsed.target
  ) {
    throw new Error(
      `Invalid words media upload checkpoint file: ${file}. Delete it and retry to start fresh.`,
    );
  }

  const targetResult = parseWordMediaTarget(parsed.target);
  if (!targetResult.ok) {
    throw new Error(
      `Invalid words media upload checkpoint target in ${file}. Delete it and retry to start fresh.`,
    );
  }

  const uploads = parsed.uploads.filter((entry): entry is WordMediaUploadPlanEntry => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Partial<WordMediaUploadPlanEntry>;
    return (
      typeof e.file === "string" &&
      typeof e.r2Filename === "string" &&
      typeof e.overwrites === "boolean" &&
      (e.lane === "image" || e.lane === "raw")
    );
  });

  return {
    version: 1,
    dir: parsed.dir,
    target: targetResult.target,
    force: parsed.force,
    files: parsed.files.filter((v): v is string => typeof v === "string"),
    skipped: parsed.skipped.filter((v): v is string => typeof v === "string"),
    uploads,
    completed: parsed.completed as Record<string, UploadedWordMediaFile>,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/* ─── Operations ─── */

async function uploadWordMediaFiles(
  target: WordMediaTarget,
  dir: string,
  opts?: { force?: boolean; onProgress?: (msg: string) => void },
): Promise<UploadWordMediaResult> {
  requireR2();

  const force = opts?.force ?? false;
  const onProgress = opts?.onProgress;
  const storageScope = await getWordMediaStorageScope(target);
  const mutableCacheControl =
    storageScope === "public" ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL : PRIVATE_MEDIA_CACHE_CONTROL;

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

  const checkpoint = readWordMediaUploadCheckpoint(absDir, target);
  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Words media checkpoint directory mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Delete it and retry.`,
    );
  }
  if (checkpoint && !sameWordMediaTarget(checkpoint.target, target)) {
    throw new Error(
      `Words media checkpoint target mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Delete it and retry.`,
    );
  }
  if (checkpoint && checkpoint.force !== force) {
    throw new Error(
      `Words media checkpoint force flag mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Rerun with the same --force setting or delete the checkpoint.`,
    );
  }
  if (checkpoint && !arraysEqual(checkpoint.files, files)) {
    throw new Error(
      `Words media source files changed since checkpoint was created (${getWordMediaUploadCheckpointPath(absDir, target)}).\n` +
        "Restore the original files or delete the checkpoint file to start a new upload.",
    );
  }

  const existingObjects = await listObjects(mediaPrefixForTarget(target), { scope: storageScope });
  const existingInfo: WordMediaFileInfo[] = existingObjects
    .filter((object) => !isWordImageInternalKey(object.key) && !object.key.includes("/incoming/"))
    .map((o) => ({
      key: o.key,
      filename: path.basename(o.key),
      size: o.size,
      lastModified: o.lastModified,
    }));
  const existingNames = new Set(existingInfo.map((i) => i.filename));

  if (existingInfo.length > 0) {
    onProgress?.(`${existingInfo.length} files already in R2 for ${targetLabel(target)}.`);
  }

  let uploadPlan: WordMediaUploadPlanEntry[];
  let skipped: string[];
  let completed: Record<string, UploadedWordMediaFile>;

  if (checkpoint) {
    uploadPlan = checkpoint.uploads;
    skipped = checkpoint.skipped;
    completed = checkpoint.completed;
  } else {
    const images: { file: string; r2Filename: string; overwrites: boolean }[] = [];
    const rawFiles: { file: string; r2Filename: string; overwrites: boolean }[] = [];
    skipped = [];
    const batchR2Names = new Set<string>();
    const duplicateBatchMappings: string[] = [];

    for (const file of files) {
      const r2Filename = toR2Filename(file);
      if (batchR2Names.has(r2Filename)) {
        duplicateBatchMappings.push(`${file} -> ${r2Filename}`);
        continue;
      }
      batchR2Names.add(r2Filename);
      const alreadyExists = existingNames.has(r2Filename);

      if (alreadyExists && !force) {
        skipped.push(r2Filename);
        onProgress?.(`Skipping ${file} → ${r2Filename} (already exists)`);
        continue;
      }

      const entry = { file, r2Filename, overwrites: alreadyExists };
      if (isProcessableImage(file)) images.push(entry);
      else rawFiles.push(entry);
    }

    if (duplicateBatchMappings.length > 0) {
      throw new Error(
        `Source files collide after filename sanitization (would overwrite each other): ` +
          `${duplicateBatchMappings.slice(0, 5).join(", ")}${duplicateBatchMappings.length > 5 ? "…" : ""}`,
      );
    }

    uploadPlan = [
      ...images.map((e) => ({ ...e, lane: "image" as const })),
      ...rawFiles.map((e) => ({ ...e, lane: "raw" as const })),
    ];
    completed = {};

    writeWordMediaUploadCheckpoint(absDir, target, {
      version: 1,
      dir: absDir,
      target,
      force,
      files,
      skipped,
      uploads: uploadPlan,
      completed,
    });
  }

  const totalNew = uploadPlan.length;
  if (totalNew === 0) {
    onProgress?.("All files already uploaded. Nothing new to process.");
    try {
      deleteWordMediaUploadCheckpoint(absDir, target);
    } catch {
      // Ignore stale cleanup failures.
    }
    return { uploaded: [], skipped, existing: existingInfo };
  }

  const parts: string[] = [];
  const imagePlan = uploadPlan.filter((e) => e.lane === "image");
  const rawPlan = uploadPlan.filter((e) => e.lane === "raw");
  if (imagePlan.length > 0)
    parts.push(`${imagePlan.length} image${imagePlan.length > 1 ? "s" : ""}`);
  if (rawPlan.length > 0)
    parts.push(`${rawPlan.length} other file${rawPlan.length > 1 ? "s" : ""}`);

  const pendingPlan = uploadPlan.filter((entry) => !completed[entry.file]);
  const resumedCount = uploadPlan.length - pendingPlan.length;
  if (checkpoint) {
    onProgress?.(
      `Resuming upload to ${targetLabel(target)}: ${resumedCount}/${uploadPlan.length} files already complete.`,
    );
  } else {
    onProgress?.(`Uploading to ${targetLabel(target)}: ${parts.join(" + ")}...`);
  }

  let checkpointWriteQueue = Promise.resolve();
  const queueCheckpointWrite = () => {
    checkpointWriteQueue = checkpointWriteQueue.then(() =>
      Promise.resolve().then(() =>
        writeWordMediaUploadCheckpoint(absDir, target, {
          version: 1,
          dir: absDir,
          target,
          force,
          files,
          skipped,
          uploads: uploadPlan,
          completed,
        }),
      ),
    );
    return checkpointWriteQueue;
  };

  try {
    await mapConcurrent(
      pendingPlan.filter((e) => e.lane === "image"),
      IMAGE_CONCURRENCY,
      async ({ file, r2Filename, overwrites }): Promise<UploadedWordMediaFile> => {
        const raw = fs.readFileSync(path.join(absDir, file));
        const r2Key = `${mediaPrefixForTarget(target)}${r2Filename}`;

        onProgress?.(
          overwrites ? `Re-uploading ${r2Filename} (overwrite)...` : `Processing ${file}...`,
        );

        const image = await processResponsiveImage(raw, file);
        const largest = image.variants.at(-1);
        if (!largest) throw new Error(`No responsive variants generated for ${file}`);
        await Promise.all([
          uploadBuffer(r2Key, largest.formats.webp.buffer, "image/webp", {
            scope: storageScope,
            cacheControl: mutableCacheControl,
          }),
          ...image.variants.flatMap((variant) =>
            (["avif", "webp"] as const).map((format) => {
              const output = variant.formats[format];
              return uploadBuffer(
                wordImageVariantKey(target, r2Filename, variant.width, format),
                output.buffer,
                output.contentType,
                {
                  scope: storageScope,
                  cacheControl:
                    storageScope === "public"
                      ? VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL
                      : PRIVATE_MEDIA_CACHE_CONTROL,
                },
              );
            }),
          ),
        ]);
        await pruneWordImageVariants(
          target,
          r2Filename,
          image.variants.map((variant) => variant.width),
          storageScope,
        );
        const uploaded: UploadedWordMediaFile = {
          original: file,
          filename: r2Filename,
          kind: "image",
          width: image.width,
          height: image.height,
          size: largest.formats.webp.buffer.byteLength,
          markdown: toMarkdownSnippetForTarget(target, r2Filename, "image"),
          overwrote: overwrites,
          image: {
            width: image.width,
            height: image.height,
            version: image.version,
            widths: image.variants.map((variant) => variant.width),
            placeholder: image.placeholder,
          },
        };
        completed[file] = uploaded;
        await queueCheckpointWrite();
        onProgress?.(`Uploaded ${r2Filename} (${image.width}×${image.height})`);

        return uploaded;
      },
    );

    await mapConcurrent(
      pendingPlan.filter((e) => e.lane === "raw"),
      RAW_CONCURRENCY,
      async ({ file, r2Filename, overwrites }): Promise<UploadedWordMediaFile> => {
        const raw = fs.readFileSync(path.join(absDir, file));
        const mimeType = getMimeType(file);
        const kind = getFileKind(file);
        const r2Key = `${mediaPrefixForTarget(target)}${r2Filename}`;

        onProgress?.(
          overwrites
            ? `Re-uploading ${r2Filename} (overwrite)...`
            : `Uploading ${file} (${formatBytes(raw.byteLength)}, ${kind})...`,
        );

        await uploadBuffer(r2Key, raw, mimeType, {
          scope: storageScope,
          cacheControl: mutableCacheControl,
        });
        const uploaded: UploadedWordMediaFile = {
          original: file,
          filename: r2Filename,
          kind,
          size: raw.byteLength,
          markdown: toMarkdownSnippetForTarget(target, r2Filename, kind),
          overwrote: overwrites,
        };
        completed[file] = uploaded;
        await queueCheckpointWrite();
        onProgress?.(`Uploaded ${r2Filename}`);

        return uploaded;
      },
    );
  } finally {
    await checkpointWriteQueue;
  }

  const uploadedOrdered = uploadPlan
    .filter((entry) => !!completed[entry.file])
    .map((entry) => completed[entry.file]);

  if (uploadedOrdered.length !== uploadPlan.length) {
    throw new Error(
      `Words media checkpoint incomplete (${uploadedOrdered.length}/${uploadPlan.length}). Rerun the same media upload command to continue.`,
    );
  }

  const imageEntries = Object.fromEntries(
    uploadedOrdered.flatMap((file) => (file.image ? [[file.filename, file.image]] : [])),
  );
  if (Object.keys(imageEntries).length > 0) {
    await mergeWordImageMetadata(target, imageEntries, storageScope);
  }

  try {
    deleteWordMediaUploadCheckpoint(absDir, target);
  } catch {
    // Non-fatal: uploads are complete, user can remove stale checkpoint manually.
  }

  return {
    uploaded: uploadedOrdered,
    skipped,
    existing: existingInfo,
  };
}

async function listWordMediaFiles(target: WordMediaTarget): Promise<WordMediaFileInfo[]> {
  requireR2();

  const scope = await getWordMediaStorageScope(target);
  const objects = await listObjects(mediaPrefixForTarget(target), { scope });
  return objects
    .filter((object) => !isWordImageInternalKey(object.key) && !object.key.includes("/incoming/"))
    .map((obj) => ({
      key: obj.key,
      filename: path.basename(obj.key),
      size: obj.size,
      lastModified: obj.lastModified,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

async function deleteWordMediaFile(
  target: WordMediaTarget,
  filename: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  requireR2();

  const key = `${mediaPrefixForTarget(target)}${filename}`;
  const scope = await getWordMediaStorageScope(target);
  onProgress?.(`Deleting ${key}...`);
  const manifest = await readWordImageManifest(target, scope);
  const stem = filename.replace(/\.[^.]+$/, "");
  const variants = await listObjects(`${mediaPrefixForTarget(target)}_responsive/${stem}/`, {
    scope,
  });
  await deleteObjects([key, ...variants.map((variant) => variant.key)], { scope });
  if (manifest[filename]) {
    delete manifest[filename];
    await writeWordImageManifest(target, manifest, scope);
  }
  onProgress?.("Done.");
}

async function deleteAllWordMediaFiles(
  target: WordMediaTarget,
  onProgress?: (msg: string) => void,
): Promise<number> {
  requireR2();

  const scope = await getWordMediaStorageScope(target);
  const objects = await listObjects(mediaPrefixForTarget(target), { scope });
  const keys = objects.map((o) => o.key);

  if (keys.length === 0) {
    onProgress?.(`No files found for ${targetLabel(target)}.`);
    return 0;
  }

  onProgress?.(`Deleting ${keys.length} files from ${targetLabel(target)}...`);
  const deleted = await deleteObjects(keys, { scope });
  onProgress?.("Done.");
  return deleted;
}

async function backfillWordImageVariants(
  onProgress?: (msg: string) => void,
  options?: { force?: boolean },
): Promise<{ processed: number; skipped: number; failed: number }> {
  requireR2();
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const locations = [
    { prefix: "words/media/", scope: "public" as const },
    { prefix: "words/assets/", scope: "public" as const },
    { prefix: "words/media/", scope: "private" as const },
  ];

  for (const source of locations) {
    const objects = await listObjects(source.prefix, { scope: source.scope });
    const canonicalImages = objects
      .map((object) => parseWordImageLocation(object.key))
      .filter((location): location is NonNullable<typeof location> => !!location)
      .filter((location) => location.filename.endsWith(".webp"));

    for (const location of canonicalImages) {
      try {
        const manifest = await readWordImageManifest(location.target, source.scope);
        if (manifest[location.filename] && !options?.force) {
          skipped++;
          continue;
        }
        onProgress?.(`${source.scope}: ${location.canonicalRef}`);
        const raw = await downloadBuffer(location.canonicalRef, { scope: source.scope });
        const image = await processResponsiveImage(raw, ".webp");
        await Promise.all(
          image.variants.flatMap((variant) =>
            (["avif", "webp"] as const).map((format) => {
              const output = variant.formats[format];
              return uploadBuffer(
                wordImageVariantKey(location.target, location.filename, variant.width, format),
                output.buffer,
                output.contentType,
                {
                  scope: source.scope,
                  cacheControl:
                    source.scope === "public"
                      ? VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL
                      : PRIVATE_MEDIA_CACHE_CONTROL,
                },
              );
            }),
          ),
        );
        await pruneWordImageVariants(
          location.target,
          location.filename,
          image.variants.map((variant) => variant.width),
          source.scope,
        );
        await setObjectHttpMetadata(
          location.canonicalRef,
          {
            cacheControl:
              source.scope === "public"
                ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL
                : PRIVATE_MEDIA_CACHE_CONTROL,
          },
          { scope: source.scope },
        );
        await mergeWordImageMetadata(
          location.target,
          {
            [location.filename]: {
              width: image.width,
              height: image.height,
              version: image.version,
              widths: image.variants.map((variant) => variant.width),
              placeholder: image.placeholder,
            },
          },
          source.scope,
        );
        processed++;
      } catch (error) {
        failed++;
        onProgress?.(`  failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { processed, skipped, failed };
}

export {
  uploadWordMediaFiles,
  getWordMediaUploadCheckpointFilename,
  listWordMediaFiles,
  deleteWordMediaFile,
  deleteAllWordMediaFiles,
  backfillWordImageVariants,
  scanOrphanWordMediaFolders,
  cleanupOrphanWordMediaFolders,
};

export type {
  UploadedWordMediaFile,
  UploadWordMediaResult,
  WordMediaFileInfo,
  WordMediaTarget,
  WordMediaOrphanSummary,
  WordMediaOrphanCleanupResult,
};
