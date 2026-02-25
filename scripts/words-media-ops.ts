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
  parseWordMediaTarget,
  toMarkdownSnippetForTarget,
  toR2Filename,
  type WordMediaTarget,
} from "../features/words/upload";
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
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET in .env.local."
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
  checkpoint: WordMediaUploadCheckpoint
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
  return a.scope === b.scope && (a.scope === "asset" ? a.assetId === (b as { assetId: string }).assetId : a.slug === (b as { slug: string }).slug);
}

function readWordMediaUploadCheckpoint(
  absDir: string,
  target: WordMediaTarget
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
      `Invalid words media upload checkpoint file: ${file}. Delete it and retry to start fresh.`
    );
  }

  const targetResult = parseWordMediaTarget(parsed.target);
  if (!targetResult.ok) {
    throw new Error(
      `Invalid words media upload checkpoint target in ${file}. Delete it and retry to start fresh.`
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

  const checkpoint = readWordMediaUploadCheckpoint(absDir, target);
  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Words media checkpoint directory mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Delete it and retry.`
    );
  }
  if (checkpoint && !sameWordMediaTarget(checkpoint.target, target)) {
    throw new Error(
      `Words media checkpoint target mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Delete it and retry.`
    );
  }
  if (checkpoint && checkpoint.force !== force) {
    throw new Error(
      `Words media checkpoint force flag mismatch at ${getWordMediaUploadCheckpointPath(absDir, target)}. Rerun with the same --force setting or delete the checkpoint.`
    );
  }
  if (checkpoint && !arraysEqual(checkpoint.files, files)) {
    throw new Error(
      `Words media source files changed since checkpoint was created (${getWordMediaUploadCheckpointPath(absDir, target)}).\n` +
      "Restore the original files or delete the checkpoint file to start a new upload."
    );
  }

  const existingObjects = await listObjects(mediaPrefixForTarget(target));
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
        `${duplicateBatchMappings.slice(0, 5).join(", ")}${duplicateBatchMappings.length > 5 ? "…" : ""}`
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
  if (imagePlan.length > 0) parts.push(`${imagePlan.length} image${imagePlan.length > 1 ? "s" : ""}`);
  if (rawPlan.length > 0) parts.push(`${rawPlan.length} other file${rawPlan.length > 1 ? "s" : ""}`);

  const pendingPlan = uploadPlan.filter((entry) => !completed[entry.file]);
  const resumedCount = uploadPlan.length - pendingPlan.length;
  if (checkpoint) {
    onProgress?.(
      `Resuming upload to ${targetLabel(target)}: ${resumedCount}/${uploadPlan.length} files already complete.`
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
        })
      )
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

        onProgress?.(overwrites ? `Re-uploading ${r2Filename} (overwrite)...` : `Processing ${file}...`);

        const { buffer, width, height } = await processToWebP(raw);
        await uploadBuffer(r2Key, buffer, "image/webp");
        const uploaded: UploadedWordMediaFile = {
          original: file,
          filename: r2Filename,
          kind: "image",
          width,
          height,
          size: buffer.byteLength,
          markdown: toMarkdownSnippetForTarget(target, r2Filename, "image"),
          overwrote: overwrites,
        };
        completed[file] = uploaded;
        await queueCheckpointWrite();
        onProgress?.(`Uploaded ${r2Filename} (${width}×${height})`);

        return uploaded;
      }
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
            : `Uploading ${file} (${formatBytes(raw.byteLength)}, ${kind})...`
        );

        await uploadBuffer(r2Key, raw, mimeType);
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
      }
    );
  } finally {
    await checkpointWriteQueue;
  }

  const uploadedOrdered = uploadPlan
    .filter((entry) => !!completed[entry.file])
    .map((entry) => completed[entry.file]);

  if (uploadedOrdered.length !== uploadPlan.length) {
    throw new Error(
      `Words media checkpoint incomplete (${uploadedOrdered.length}/${uploadPlan.length}). Rerun the same media upload command to continue.`
    );
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

  const objects = await listObjects(mediaPrefixForTarget(target));
  return objects
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
  onProgress?: (msg: string) => void
): Promise<void> {
  requireR2();

  const key = `${mediaPrefixForTarget(target)}${filename}`;
  onProgress?.(`Deleting ${key}...`);
  await deleteObjects([key]);
  onProgress?.("Done.");
}

async function deleteAllWordMediaFiles(
  target: WordMediaTarget,
  onProgress?: (msg: string) => void
): Promise<number> {
  requireR2();

  const objects = await listObjects(mediaPrefixForTarget(target));
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

export {
  uploadWordMediaFiles,
  getWordMediaUploadCheckpointFilename,
  listWordMediaFiles,
  deleteWordMediaFile,
  deleteAllWordMediaFiles,
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
