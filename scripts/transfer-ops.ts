/**
 * Transfer business logic.
 *
 * Handles file processing, R2 upload/delete, and Redis metadata
 * for temporary private transfers. Supports images, videos, GIFs,
 * audio, documents, archives — anything you throw at it.
 */

import fs from "fs";
import path from "path";
import {
  deleteObjects,
  listObjects,
  listPrefixes,
  isConfigured,
} from "./r2-client";
import {
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  mapConcurrent,
} from "../features/media/processing";
import { processTransferFile, sortTransferFiles } from "../features/transfers/upload";
import type { ProcessFileResult } from "../features/transfers/upload";
import { BASE_URL } from "../lib/shared/config";
import { getRedis } from "../lib/platform/redis";
import {
  saveTransfer,
  getTransfer,
  listTransfers,
  deleteTransferData,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  formatDuration,
  DEFAULT_EXPIRY_SECONDS,
} from "../features/transfers/store";
import type { TransferData, TransferSummary } from "../features/transfers/store";

/* ─── Preflight checks ─── */

/**
 * Ensure Redis is reachable before performing transfer operations.
 * Without this, transfers silently save to in-memory (which dies with
 * the CLI process) and the web app can't find them.
 */
function requireRedis(): void {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "Redis/KV not configured. Transfer metadata requires Redis to persist.\n" +
      "Add KV_REST_API_URL and KV_REST_API_TOKEN to .env.local.\n" +
      "Copy them from your Vercel dashboard → Storage → KV."
    );
  }
}

function requireR2(): void {
  if (!isConfigured()) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET in .env.local."
    );
  }
}

/* ─── Types ─── */

type CreateTransferOpts = {
  dir: string;
  title: string;
  /** Expiry string like "7d", "24h", "30m" */
  expires?: string;
};

type CreateTransferResult = {
  transfer: TransferData;
  shareUrl: string;
  adminUrl: string;
  /** Bytes uploaded to R2 (all variants combined) */
  totalSize: number;
  fileCounts: { images: number; videos: number; gifs: number; audio: number; other: number };
};

type AppendTransferOpts = {
  id: string;
  dir: string;
};

type AppendTransferResult = {
  transfer: TransferData;
  shareUrl: string;
  adminUrl: string;
  addedCount: number;
  addedSize: number;
  fileCounts: { images: number; videos: number; gifs: number; audio: number; other: number };
};

/* ─── Transfer operations ─── */

/** Images/GIFs: 3 concurrent (Sharp is CPU-heavy). Raw: 6 (network-bound). */
const IMAGE_CONCURRENCY = 3;
const RAW_CONCURRENCY = 6;
const TRANSFER_CHECKPOINT_FILE = ".mah-transfer-upload.checkpoint.json";

type TransferUploadCheckpoint = {
  version: 1;
  dir: string;
  entries: string[];
  transferId: string;
  deleteToken: string;
  title: string;
  ttlSeconds: number;
  startedAt: string;
  completed: Record<string, ProcessFileResult>;
};

function getTransferCheckpointPath(absDir: string): string {
  return path.join(absDir, TRANSFER_CHECKPOINT_FILE);
}

function writeTransferCheckpoint(absDir: string, checkpoint: TransferUploadCheckpoint): void {
  const file = getTransferCheckpointPath(absDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function deleteTransferCheckpoint(absDir: string): void {
  const file = getTransferCheckpointPath(absDir);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readTransferCheckpoint(absDir: string): TransferUploadCheckpoint | null {
  const file = getTransferCheckpointPath(absDir);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Partial<TransferUploadCheckpoint>;

  if (
    parsed.version !== 1 ||
    typeof parsed.dir !== "string" ||
    !Array.isArray(parsed.entries) ||
    typeof parsed.transferId !== "string" ||
    typeof parsed.deleteToken !== "string" ||
    typeof parsed.title !== "string" ||
    typeof parsed.ttlSeconds !== "number" ||
    typeof parsed.startedAt !== "string" ||
    !parsed.completed ||
    typeof parsed.completed !== "object"
  ) {
    throw new Error(
      `Invalid transfer checkpoint file: ${file}. Delete it and retry to start fresh.`
    );
  }

  return {
    version: 1,
    dir: parsed.dir,
    entries: parsed.entries.filter((v): v is string => typeof v === "string"),
    transferId: parsed.transferId,
    deleteToken: parsed.deleteToken,
    title: parsed.title,
    ttlSeconds: Math.max(1, Math.floor(parsed.ttlSeconds)),
    startedAt: parsed.startedAt,
    completed: parsed.completed as Record<string, ProcessFileResult>,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function resolveTransferDir(dir: string): string {
  return path.resolve(dir.replace(/^~/, process.env.HOME ?? "~"));
}

function listTransferEntries(absDir: string): string[] {
  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const entries = fs
    .readdirSync(absDir)
    .filter((f) => !f.startsWith(".") && fs.statSync(path.join(absDir, f)).isFile())
    .sort();

  if (entries.length === 0) {
    throw new Error(`No files found in ${absDir}`);
  }

  return entries;
}

function transferFileCounts(files: TransferData["files"]) {
  return {
    images: files.filter((f) => f.kind === "image").length,
    gifs: files.filter((f) => f.kind === "gif").length,
    videos: files.filter((f) => f.kind === "video").length,
    audio: files.filter((f) => f.kind === "audio").length,
    other: files.filter((f) => f.kind === "file").length,
  };
}

function predictedTransferFileId(filename: string): string {
  if (PROCESSABLE_EXTENSIONS.test(filename) || ANIMATED_EXTENSIONS.test(filename)) {
    return path.basename(filename, path.extname(filename));
  }
  return filename;
}

/** Create a new transfer: process files, upload to R2, save metadata to Redis */
async function createTransfer(
  opts: CreateTransferOpts,
  onProgress?: (msg: string) => void
): Promise<CreateTransferResult> {
  requireRedis();
  requireR2();

  const absDir = resolveTransferDir(opts.dir);
  const entries = listTransferEntries(absDir);

  const checkpoint = readTransferCheckpoint(absDir);
  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Transfer checkpoint directory mismatch at ${getTransferCheckpointPath(absDir)}. Delete it and retry.`
    );
  }

  if (checkpoint && !arraysEqual(checkpoint.entries, entries)) {
    throw new Error(
      `Transfer source files changed since checkpoint was created (${getTransferCheckpointPath(absDir)}).\n` +
      "Restore the original files or delete the checkpoint file to start a new transfer."
    );
  }

  const ttlSeconds = checkpoint
    ? checkpoint.ttlSeconds
    : opts.expires
      ? parseExpiry(opts.expires)
      : DEFAULT_EXPIRY_SECONDS;

  const transferId = checkpoint?.transferId ?? generateTransferId();
  const deleteToken = checkpoint?.deleteToken ?? generateDeleteToken();
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  const completed = checkpoint?.completed ?? {};

  if (!checkpoint) {
    writeTransferCheckpoint(absDir, {
      version: 1,
      dir: absDir,
      entries,
      transferId,
      deleteToken,
      title: opts.title,
      ttlSeconds,
      startedAt,
      completed,
    });
  }

  // Classify for concurrency control (Sharp is CPU-heavy)
  const pendingEntries = entries.filter((f) => !completed[f]);
  const heavy = pendingEntries.filter(
    (f) => PROCESSABLE_EXTENSIONS.test(f) || ANIMATED_EXTENSIONS.test(f)
  );
  const light = pendingEntries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f) && !ANIMATED_EXTENSIONS.test(f)
  );

  const resumedCount = entries.length - pendingEntries.length;
  if (checkpoint) {
    onProgress?.(
      `Resuming transfer ${transferId}: ${resumedCount}/${entries.length} files already complete.`
    );
    if (checkpoint.title !== opts.title) {
      onProgress?.(`Using checkpoint title "${checkpoint.title}" (ignoring current title for consistency).`);
    }
  } else {
    onProgress?.(
      `Found ${entries.length} files. Creating transfer ${transferId}...`
    );
  }

  let checkpointWriteQueue = Promise.resolve();
  const queueCheckpointWrite = () => {
    checkpointWriteQueue = checkpointWriteQueue.then(() =>
      Promise.resolve().then(() =>
        writeTransferCheckpoint(absDir, {
          version: 1,
          dir: absDir,
          entries,
          transferId,
          deleteToken,
          title: checkpoint?.title ?? opts.title,
          ttlSeconds,
          startedAt,
          completed,
        })
      )
    );
    return checkpointWriteQueue;
  };

  const processFile = async (file: string) => {
    const raw = fs.readFileSync(path.join(absDir, file));
    onProgress?.(`Processing ${file}...`);
    const result = await processTransferFile(raw, file, transferId);
    completed[file] = result;
    await queueCheckpointWrite();
    onProgress?.(`Uploaded ${file}`);
    return result;
  };

  try {
    await mapConcurrent(heavy, IMAGE_CONCURRENCY, processFile);
    await mapConcurrent(light, RAW_CONCURRENCY, processFile);
  } finally {
    await checkpointWriteQueue;
  }

  const allResults = entries.filter((file): file is string => !!completed[file]).map((file) => completed[file]);

  if (allResults.length !== entries.length) {
    throw new Error(
      `Transfer checkpoint incomplete (${allResults.length}/${entries.length}). Rerun the same command to continue.`
    );
  }

  const sortedFiles = sortTransferFiles(allResults.map((r) => r.file));
  const totalSize = allResults.reduce((sum, r) => sum + r.uploadedBytes, 0);

  const createdAt = new Date(startedAt);
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const remainingTtlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (remainingTtlSeconds <= 0) {
    throw new Error(
      `Transfer ${transferId} expired before finalizing. Delete ${getTransferCheckpointPath(absDir)} and retry with a longer --expires.`
    );
  }

  const transfer: TransferData = {
    id: transferId,
    title: checkpoint?.title ?? opts.title,
    files: sortedFiles,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deleteToken,
  };

  await saveTransfer(transfer, remainingTtlSeconds);
  try {
    deleteTransferCheckpoint(absDir);
  } catch {
    // Non-fatal: the transfer is created, user can delete the stale checkpoint manually.
  }

  const shareUrl = `${BASE_URL}/t/${transferId}`;
  const adminUrl = `${BASE_URL}/t/${transferId}?token=${deleteToken}`;

  const fileCounts = transferFileCounts(sortedFiles);

  return { transfer, shareUrl, adminUrl, totalSize, fileCounts };
}

/** Append files to an existing active transfer and preserve its expiry. */
async function appendToTransfer(
  opts: AppendTransferOpts,
  onProgress?: (msg: string) => void
): Promise<AppendTransferResult> {
  requireRedis();
  requireR2();

  const transfer = await getTransfer(opts.id);
  if (!transfer) {
    throw new Error(`Transfer "${opts.id}" not found or already expired.`);
  }

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000
  );
  if (remainingTtlSeconds <= 0) {
    throw new Error(`Transfer "${opts.id}" has already expired.`);
  }

  const absDir = resolveTransferDir(opts.dir);
  const entries = listTransferEntries(absDir);

  const existingIds = new Set(transfer.files.map((f) => f.id));
  const existingNames = new Set(transfer.files.map((f) => f.filename));
  const newPredictedIds = new Set<string>();
  const duplicateNames: string[] = [];
  const duplicateIds: string[] = [];
  const duplicateIdsWithinSource: string[] = [];

  for (const file of entries) {
    const predictedId = predictedTransferFileId(file);
    if (existingNames.has(file)) duplicateNames.push(file);
    if (existingIds.has(predictedId)) duplicateIds.push(`${file} → ${predictedId}`);
    if (newPredictedIds.has(predictedId)) duplicateIdsWithinSource.push(`${file} → ${predictedId}`);
    newPredictedIds.add(predictedId);
  }

  if (duplicateNames.length > 0 || duplicateIds.length > 0 || duplicateIdsWithinSource.length > 0) {
    const parts: string[] = [];
    if (duplicateNames.length > 0) {
      parts.push(`Existing filenames conflict: ${duplicateNames.slice(0, 5).join(", ")}${duplicateNames.length > 5 ? "…" : ""}`);
    }
    if (duplicateIds.length > 0) {
      parts.push(`Existing media IDs conflict: ${duplicateIds.slice(0, 5).join(", ")}${duplicateIds.length > 5 ? "…" : ""}`);
    }
    if (duplicateIdsWithinSource.length > 0) {
      parts.push(
        `Source folder contains duplicate transfer IDs (same image/GIF stem): ${duplicateIdsWithinSource.slice(0, 5).join(", ")}${duplicateIdsWithinSource.length > 5 ? "…" : ""}`
      );
    }
    throw new Error(
      `Append aborted to avoid overwriting existing transfer files.\n${parts.join("\n")}`
    );
  }

  onProgress?.(`Appending ${entries.length} files to transfer ${transfer.id}...`);

  const heavy = entries.filter(
    (f) => PROCESSABLE_EXTENSIONS.test(f) || ANIMATED_EXTENSIONS.test(f)
  );
  const light = entries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f) && !ANIMATED_EXTENSIONS.test(f)
  );

  const processFile = async (file: string) => {
    const raw = fs.readFileSync(path.join(absDir, file));
    onProgress?.(`Processing ${file}...`);
    const result = await processTransferFile(raw, file, transfer.id);
    onProgress?.(`Uploaded ${file}`);
    return result;
  };

  const heavyResults = await mapConcurrent(heavy, IMAGE_CONCURRENCY, processFile);
  const lightResults = await mapConcurrent(light, RAW_CONCURRENCY, processFile);
  const addedResults = [...heavyResults, ...lightResults];

  const mergedFiles = sortTransferFiles([...transfer.files, ...addedResults.map((r) => r.file)]);
  const updatedTransfer: TransferData = {
    ...transfer,
    files: mergedFiles,
  };

  await saveTransfer(updatedTransfer, remainingTtlSeconds);

  return {
    transfer: updatedTransfer,
    shareUrl: `${BASE_URL}/t/${transfer.id}`,
    adminUrl: `${BASE_URL}/t/${transfer.id}?token=${transfer.deleteToken}`,
    addedCount: addedResults.length,
    addedSize: addedResults.reduce((sum, r) => sum + r.uploadedBytes, 0),
    fileCounts: transferFileCounts(addedResults.map((r) => r.file) as TransferData["files"]),
  };
}

/** Get a transfer's full data and computed metadata */
async function getTransferInfo(
  id: string
): Promise<(TransferData & { remainingSeconds: number }) | null> {
  requireRedis();
  const transfer = await getTransfer(id);
  if (!transfer) return null;

  const remaining = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000
  );

  return { ...transfer, remainingSeconds: remaining };
}

/** List all active transfers with time remaining */
async function listActiveTransfers(): Promise<TransferSummary[]> {
  requireRedis();
  return listTransfers();
}

/** Delete a transfer: remove R2 files + Redis metadata */
async function deleteTransfer(
  id: string,
  onProgress?: (msg: string) => void
): Promise<{ deletedFiles: number; dataDeleted: boolean }> {
  requireRedis();
  requireR2();
  const prefix = `transfers/${id}/`;
  onProgress?.(`Listing files under ${prefix}...`);

  const objects = await listObjects(prefix);
  const keys = objects.map((o) => o.key);

  let deletedFiles = 0;
  if (keys.length > 0) {
    onProgress?.(`Deleting ${keys.length} files from R2...`);
    deletedFiles = await deleteObjects(keys);
  }

  const dataDeleted = await deleteTransferData(id);
  onProgress?.("Done.");

  return { deletedFiles, dataDeleted };
}

/**
 * Cleanup expired/orphaned transfers without touching active ones.
 */
async function cleanupExpiredTransfers(
  onProgress?: (msg: string) => void
): Promise<{ expiredIndexEntries: number; scannedPrefixes: number; deletedObjects: number }> {
  requireRedis();
  requireR2();

  const redis = getRedis()!;
  const indexedIds: string[] = await redis.smembers("transfer:index");

  let expiredIds: string[] = [];
  if (indexedIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of indexedIds) {
      pipeline.exists(`transfer:${id}`);
    }
    const results = await pipeline.exec();
    expiredIds = indexedIds.filter((_, i) => results[i] === 0);
  }

  if (expiredIds.length > 0) {
    onProgress?.(`Removing ${expiredIds.length} expired transfer index entries...`);
    const cleanupPipeline = redis.pipeline();
    for (const id of expiredIds) {
      cleanupPipeline.srem("transfer:index", id);
    }
    await cleanupPipeline.exec();
  }

  onProgress?.("Scanning R2 transfer prefixes...");
  const transferPrefixes = await listPrefixes("transfers/");
  const allR2Ids = transferPrefixes
    .map((p) => p.replace("transfers/", "").replace(/\/$/, ""))
    .filter(Boolean);

  let deletedObjects = 0;
  for (const id of allR2Ids) {
    const exists = await redis.exists(`transfer:${id}`);
    if (exists) continue;

    const objects = await listObjects(`transfers/${id}/`);
    const keys = objects.map((o) => o.key);
    if (keys.length > 0) {
      onProgress?.(`Deleting ${keys.length} orphaned files for transfer ${id}...`);
      deletedObjects += await deleteObjects(keys);
    }
    await redis.srem("transfer:index", id);
  }

  return {
    expiredIndexEntries: expiredIds.length,
    scannedPrefixes: allR2Ids.length,
    deletedObjects,
  };
}

/**
 * Nuke all transfers: wipe every R2 object under transfers/ and
 * clear the Redis index + all transfer:* keys. Full reset.
 */
async function nukeAllTransfers(
  onProgress?: (msg: string) => void
): Promise<{ deletedFiles: number; deletedKeys: number }> {
  requireRedis();
  requireR2();

  const redis = getRedis()!;

  /* ─── R2 cleanup ─── */
  onProgress?.("Listing all R2 objects under transfers/...");
  const objects = await listObjects("transfers/");
  const keys = objects.map((o) => o.key);

  let deletedFiles = 0;
  if (keys.length > 0) {
    onProgress?.(`Deleting ${keys.length} files from R2...`);
    deletedFiles = await deleteObjects(keys);
  } else {
    onProgress?.("No R2 objects found under transfers/.");
  }

  /* ─── Redis cleanup ─── */
  onProgress?.("Clearing Redis transfer metadata...");
  const indexedIds: string[] = await redis.smembers("transfer:index");
  let deletedKeys = 0;

  if (indexedIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of indexedIds) {
      pipeline.del(`transfer:${id}`);
    }
    pipeline.del("transfer:index");
    await pipeline.exec();
    deletedKeys = indexedIds.length;
  } else {
    // Index may be empty but stale keys might exist — just delete the index
    await redis.del("transfer:index");
  }

  onProgress?.("Done.");
  return { deletedFiles, deletedKeys };
}

export {
  createTransfer,
  appendToTransfer,
  getTransferInfo,
  listActiveTransfers,
  deleteTransfer,
  cleanupExpiredTransfers,
  nukeAllTransfers,
  formatDuration,
  parseExpiry,
};

export type { CreateTransferOpts, CreateTransferResult, AppendTransferOpts, AppendTransferResult };
