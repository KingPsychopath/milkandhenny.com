/**
 * Transfer business logic.
 *
 * Handles file processing, R2 upload/delete, and Redis metadata
 * for temporary private transfers. Supports images, videos, GIFs,
 * audio, documents, archives — anything you throw at it.
 */

import fs from "fs";
import path from "path";
import { Effect } from "effect";
import { isTransferStorageConfigured } from "./r2-client";
import { PROCESSABLE_EXTENSIONS, ANIMATED_EXTENSIONS } from "../features/media/processing.server";
import {
  buildTransferProcessingCounts,
  resolveTransferUploadIds,
  type TransferProcessingCounts,
} from "../features/transfers/media-state";
import { resolveTransferFileForDelete } from "../features/transfers/delete";
import {
  applyTransferAssetGroups,
  processTransferFile,
  sortTransferFiles,
} from "../features/transfers/upload.server";
import type { ProcessFileResult } from "../features/transfers/upload.server";
import { getTransferMediaQueueLength } from "../features/transfers/media-queue.server";
import { getTransferMediaWorkerStatus } from "../features/transfers/media-worker-status.server";
import { isSafeTransferId } from "../features/transfers/admin.server";
import { MediaWorkerService, runMediaEffect } from "../features/system/media-worker-runtime.server";
import { TransferOperationsService } from "../features/transfers/transfer-operations-service.server";
import { TransferMediaOperationsService } from "../features/transfers/transfer-media-operations-service.server";
import { BASE_URL } from "../lib/shared/config";
import { buildTransferUrl } from "../features/transfers/routes";
import { getRedis } from "../lib/platform/redis.server";
import { withOperationSignal } from "../lib/platform/operation-context.server";
import { getInlineProcessingTimeoutMs } from "../features/transfers/media-processing-config.server";
import {
  saveTransfer,
  getTransfer,
  listTransfers,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  formatDuration,
  DEFAULT_EXPIRY_SECONDS,
} from "../features/transfers/store.server";
import type { TransferData, TransferSummary } from "../features/transfers/types";

function runTransferOperation<A, E>(
  use: (transfers: typeof TransferOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* use(yield* TransferOperationsService);
    }),
  );
}

function runConcurrent<A, B>(
  items: readonly A[],
  concurrency: number,
  worker: (item: A) => Promise<B>,
) {
  const timeoutMs = getInlineProcessingTimeoutMs();
  return runMediaEffect(
    Effect.forEach(
      items,
      (item) =>
        Effect.tryPromise({
          try: (signal) => withOperationSignal(signal, () => worker(item)),
          catch: (cause) => cause,
        }).pipe((effect) => (timeoutMs > 0 ? effect.pipe(Effect.timeout(timeoutMs)) : effect)),
      { concurrency },
    ),
  );
}

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
      "Redis not configured. Transfer metadata requires Redis to persist.\n" +
        "Add REDIS_REST_URL and REDIS_REST_TOKEN to .env.local.",
    );
  }
}

function requireR2(): void {
  if (!isTransferStorageConfigured()) {
    throw new Error(
      "Private R2 storage is not configured. Set both bucket names and their scoped credentials in .env.local.",
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
  processingCounts: TransferProcessingCounts;
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
  processingCounts: TransferProcessingCounts;
};

type TransferMediaStatusResult = {
  queueLength: number;
  worker: {
    lastHeartbeatAt?: string;
    lastProcessedAt?: string;
    lastErrorAt?: string;
    lastErrorMessage?: string;
  };
};

type ReconcileTransferMediaResult = {
  scannedTransfers: number;
  updatedTransfers: number;
  queueLength: number;
};

type ClearTransferMediaQueueResult = {
  deletedKeys: number;
  queueLengthBefore: number;
  processingLengthBefore: number;
};

type RetryTransferMediaResult = {
  transferId: string;
  selector?: string;
  requeued: boolean;
  fileCount: number;
  queueLength: number;
  target?: {
    id: string;
    filename: string;
    processingStatus?: TransferData["files"][number]["processingStatus"];
    retryCount?: number;
  };
};

/* ─── Transfer operations ─── */

/** Images/GIFs: 3 concurrent (Sharp is CPU-heavy). Raw: 6 (network-bound). */
const IMAGE_CONCURRENCY = 3;
const RAW_CONCURRENCY = 6;
const TRANSFER_CHECKPOINT_FILE = ".mah-transfer-upload.checkpoint.json";
const TRANSFER_APPEND_CHECKPOINT_PREFIX = ".mah-transfer-append.";
const TRANSFER_APPEND_CHECKPOINT_SUFFIX = ".checkpoint.json";

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

type TransferAppendCheckpoint = {
  version: 1;
  dir: string;
  entries: string[];
  transferId: string;
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
      `Invalid transfer checkpoint file: ${file}. Delete it and retry to start fresh.`,
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

function getTransferAppendCheckpointPath(absDir: string, transferId: string): string {
  return path.join(
    absDir,
    `${TRANSFER_APPEND_CHECKPOINT_PREFIX}${transferId}${TRANSFER_APPEND_CHECKPOINT_SUFFIX}`,
  );
}

function writeTransferAppendCheckpoint(
  absDir: string,
  transferId: string,
  checkpoint: TransferAppendCheckpoint,
): void {
  const file = getTransferAppendCheckpointPath(absDir, transferId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function deleteTransferAppendCheckpoint(absDir: string, transferId: string): void {
  const file = getTransferAppendCheckpointPath(absDir, transferId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readTransferAppendCheckpoint(
  absDir: string,
  transferId: string,
): TransferAppendCheckpoint | null {
  const file = getTransferAppendCheckpointPath(absDir, transferId);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Partial<TransferAppendCheckpoint>;

  if (
    parsed.version !== 1 ||
    typeof parsed.dir !== "string" ||
    !Array.isArray(parsed.entries) ||
    typeof parsed.transferId !== "string" ||
    typeof parsed.startedAt !== "string" ||
    !parsed.completed ||
    typeof parsed.completed !== "object"
  ) {
    throw new Error(
      `Invalid transfer append checkpoint file: ${file}. Delete it and retry to start fresh.`,
    );
  }

  return {
    version: 1,
    dir: parsed.dir,
    entries: parsed.entries.filter((v): v is string => typeof v === "string"),
    transferId: parsed.transferId,
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

/** Create a new transfer: process files, upload to R2, save metadata to Redis */
async function createTransfer(
  opts: CreateTransferOpts,
  onProgress?: (msg: string) => void,
): Promise<CreateTransferResult> {
  requireRedis();
  requireR2();

  const absDir = resolveTransferDir(opts.dir);
  const entries = listTransferEntries(absDir);
  const preparedEntries = resolveTransferUploadIds(entries.map((name) => ({ name })));

  const checkpoint = readTransferCheckpoint(absDir);
  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Transfer checkpoint directory mismatch at ${getTransferCheckpointPath(absDir)}. Delete it and retry.`,
    );
  }

  if (checkpoint && !arraysEqual(checkpoint.entries, entries)) {
    throw new Error(
      `Transfer source files changed since checkpoint was created (${getTransferCheckpointPath(absDir)}).\n` +
        "Restore the original files or delete the checkpoint file to start a new transfer.",
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
  const pendingEntries = preparedEntries.filter((f) => !completed[f.name]);
  const heavy = pendingEntries.filter(
    (f) => PROCESSABLE_EXTENSIONS.test(f.name) || ANIMATED_EXTENSIONS.test(f.name),
  );
  const light = pendingEntries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f.name) && !ANIMATED_EXTENSIONS.test(f.name),
  );

  const resumedCount = entries.length - pendingEntries.length;
  if (checkpoint) {
    onProgress?.(
      `Resuming transfer ${transferId}: ${resumedCount}/${entries.length} files already complete.`,
    );
    if (checkpoint.title !== opts.title) {
      onProgress?.(
        `Using checkpoint title "${checkpoint.title}" (ignoring current title for consistency).`,
      );
    }
  } else {
    onProgress?.(`Found ${entries.length} files. Creating transfer ${transferId}...`);
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
        }),
      ),
    );
    return checkpointWriteQueue;
  };

  const processFile = async (file: { name: string; mediaId: string }) => {
    const raw = fs.readFileSync(path.join(absDir, file.name));
    onProgress?.(`Processing ${file.name}...`);
    const result = await processTransferFile(raw, { ...file, size: raw.byteLength }, transferId);
    completed[file.name] = result;
    await queueCheckpointWrite();
    onProgress?.(`Uploaded ${file.name}`);
    return result;
  };

  try {
    await runConcurrent(heavy, IMAGE_CONCURRENCY, processFile);
    await runConcurrent(light, RAW_CONCURRENCY, processFile);
  } finally {
    await checkpointWriteQueue;
  }

  const allResults = entries
    .filter((file): file is string => !!completed[file])
    .map((file) => completed[file]);

  if (allResults.length !== entries.length) {
    throw new Error(
      `Transfer checkpoint incomplete (${allResults.length}/${entries.length}). Rerun the same command to continue.`,
    );
  }

  const sortedFiles = sortTransferFiles(allResults.map((r) => r.file));
  const totalSize = allResults.reduce((sum, r) => sum + r.uploadedBytes, 0);

  const createdAt = new Date(startedAt);
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const remainingTtlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (remainingTtlSeconds <= 0) {
    throw new Error(
      `Transfer ${transferId} expired before finalizing. Delete ${getTransferCheckpointPath(absDir)} and retry with a longer --expires.`,
    );
  }

  const groupedTransfer = applyTransferAssetGroups(sortedFiles);
  const transfer: TransferData = {
    id: transferId,
    title: checkpoint?.title ?? opts.title,
    files: groupedTransfer.files,
    groups: groupedTransfer.groups,
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

  const shareUrl = buildTransferUrl(BASE_URL, transferId);
  const adminUrl = buildTransferUrl(BASE_URL, transferId, deleteToken);

  const fileCounts = transferFileCounts(groupedTransfer.files);
  const processingCounts = buildTransferProcessingCounts(groupedTransfer.files);

  return { transfer, shareUrl, adminUrl, totalSize, fileCounts, processingCounts };
}

/** Append files to an existing active transfer and preserve its expiry. */
async function appendToTransfer(
  opts: AppendTransferOpts,
  onProgress?: (msg: string) => void,
): Promise<AppendTransferResult> {
  requireRedis();
  requireR2();

  const transfer = await getTransfer(opts.id);
  if (!transfer) {
    throw new Error(`Transfer "${opts.id}" not found or already expired.`);
  }

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000,
  );
  if (remainingTtlSeconds <= 0) {
    throw new Error(`Transfer "${opts.id}" has already expired.`);
  }

  const absDir = resolveTransferDir(opts.dir);
  const entries = listTransferEntries(absDir);
  const preparedEntries = resolveTransferUploadIds(
    entries.map((name) => ({ name })),
    transfer.files.map((f) => f.id),
  );
  const checkpoint = readTransferAppendCheckpoint(absDir, transfer.id);

  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Transfer append checkpoint directory mismatch at ${getTransferAppendCheckpointPath(absDir, transfer.id)}. Delete it and retry.`,
    );
  }

  if (checkpoint && checkpoint.transferId !== transfer.id) {
    throw new Error(
      `Transfer append checkpoint target mismatch at ${getTransferAppendCheckpointPath(absDir, transfer.id)}. Delete it and retry.`,
    );
  }

  if (checkpoint && !arraysEqual(checkpoint.entries, entries)) {
    throw new Error(
      `Append source files changed since checkpoint was created (${getTransferAppendCheckpointPath(absDir, transfer.id)}).\n` +
        "Restore the original files or delete the checkpoint file to start the append again.",
    );
  }

  const existingIds = new Set(transfer.files.map((f) => f.id));
  const existingNames = new Set(transfer.files.map((f) => f.filename));

  if (checkpoint) {
    const completedResults = entries
      .filter((file): file is string => !!checkpoint.completed[file])
      .map((file) => checkpoint.completed[file]);

    if (completedResults.length === entries.length && entries.length > 0) {
      const alreadyFinalized = completedResults.every(
        (r) => existingIds.has(r.file.id) && existingNames.has(r.file.filename),
      );

      if (alreadyFinalized) {
        onProgress?.(
          `Append checkpoint already finalized for ${transfer.id}; cleaning up stale checkpoint.`,
        );
        try {
          deleteTransferAppendCheckpoint(absDir, transfer.id);
        } catch {
          // Ignore cleanup errors; append is already reflected in the transfer metadata.
        }
        return {
          transfer,
          shareUrl: buildTransferUrl(BASE_URL, transfer.id),
          adminUrl: buildTransferUrl(BASE_URL, transfer.id, transfer.deleteToken),
          addedCount: 0,
          addedSize: 0,
          fileCounts: { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 },
          processingCounts: buildTransferProcessingCounts([]),
        };
      }
    }
  }

  const duplicateNames: string[] = [];

  for (const file of preparedEntries) {
    if (existingNames.has(file.name)) duplicateNames.push(file.name);
  }

  if (duplicateNames.length > 0) {
    const parts: string[] = [];
    if (duplicateNames.length > 0) {
      parts.push(
        `Existing filenames conflict: ${duplicateNames.slice(0, 5).join(", ")}${duplicateNames.length > 5 ? "…" : ""}`,
      );
    }
    throw new Error(
      `Append aborted to avoid overwriting existing transfer files.\n${parts.join("\n")}`,
    );
  }

  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  const completed = checkpoint?.completed ?? {};

  if (!checkpoint) {
    writeTransferAppendCheckpoint(absDir, transfer.id, {
      version: 1,
      dir: absDir,
      entries,
      transferId: transfer.id,
      startedAt,
      completed,
    });
  }

  const pendingEntries = preparedEntries.filter((f) => !completed[f.name]);
  const resumedCount = entries.length - pendingEntries.length;

  if (checkpoint) {
    onProgress?.(
      `Resuming append to ${transfer.id}: ${resumedCount}/${entries.length} files already complete.`,
    );
  } else {
    onProgress?.(`Appending ${entries.length} files to transfer ${transfer.id}...`);
  }

  const heavy = pendingEntries.filter(
    (f) => PROCESSABLE_EXTENSIONS.test(f.name) || ANIMATED_EXTENSIONS.test(f.name),
  );
  const light = pendingEntries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f.name) && !ANIMATED_EXTENSIONS.test(f.name),
  );

  let checkpointWriteQueue = Promise.resolve();
  const queueCheckpointWrite = () => {
    checkpointWriteQueue = checkpointWriteQueue.then(() =>
      Promise.resolve().then(() =>
        writeTransferAppendCheckpoint(absDir, transfer.id, {
          version: 1,
          dir: absDir,
          entries,
          transferId: transfer.id,
          startedAt,
          completed,
        }),
      ),
    );
    return checkpointWriteQueue;
  };

  const processFile = async (file: { name: string; mediaId: string }) => {
    const raw = fs.readFileSync(path.join(absDir, file.name));
    onProgress?.(`Processing ${file.name}...`);
    const result = await processTransferFile(raw, { ...file, size: raw.byteLength }, transfer.id);
    completed[file.name] = result;
    await queueCheckpointWrite();
    onProgress?.(`Uploaded ${file.name}`);
    return result;
  };

  try {
    await runConcurrent(heavy, IMAGE_CONCURRENCY, processFile);
    await runConcurrent(light, RAW_CONCURRENCY, processFile);
  } finally {
    await checkpointWriteQueue;
  }

  const addedResults = entries
    .filter((file): file is string => !!completed[file])
    .map((file) => completed[file]);

  if (addedResults.length !== entries.length) {
    throw new Error(
      `Append checkpoint incomplete (${addedResults.length}/${entries.length}). Rerun the same transfers append command to continue.`,
    );
  }

  const mergedFiles = sortTransferFiles([...transfer.files, ...addedResults.map((r) => r.file)]);
  const groupedTransfer = applyTransferAssetGroups(mergedFiles);
  const updatedTransfer: TransferData = {
    ...transfer,
    files: groupedTransfer.files,
    groups: groupedTransfer.groups,
  };

  await saveTransfer(updatedTransfer, remainingTtlSeconds);
  try {
    deleteTransferAppendCheckpoint(absDir, transfer.id);
  } catch {
    // Non-fatal: transfer is updated, user can delete the stale append checkpoint manually.
  }

  return {
    transfer: updatedTransfer,
    shareUrl: buildTransferUrl(BASE_URL, transfer.id),
    adminUrl: buildTransferUrl(BASE_URL, transfer.id, transfer.deleteToken),
    addedCount: addedResults.length,
    addedSize: addedResults.reduce((sum, r) => sum + r.uploadedBytes, 0),
    fileCounts: transferFileCounts(addedResults.map((r) => r.file) as TransferData["files"]),
    processingCounts: buildTransferProcessingCounts(addedResults.map((r) => r.file)),
  };
}

/** Get a transfer's full data and computed metadata */
async function getTransferInfo(
  id: string,
): Promise<(TransferData & { remainingSeconds: number }) | null> {
  requireRedis();
  const transfer = await getTransfer(id);
  if (!transfer) return null;

  const remaining = Math.floor((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);

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
  onProgress?: (msg: string) => void,
): Promise<{ deletedFiles: number; dataDeleted: boolean }> {
  requireRedis();
  requireR2();
  onProgress?.(`Deleting transfer ${id}...`);
  const result = await runTransferOperation((transfers) => transfers.adminDelete(id));
  onProgress?.("Done.");
  return result;
}

async function deleteTransferFile(
  id: string,
  selector: string,
  onProgress?: (msg: string) => void,
): Promise<{
  deletedObjects: number;
  deletedTransfer: boolean;
  file: TransferData["files"][number];
  transfer?: TransferData;
}> {
  requireRedis();
  requireR2();

  const transfer = await getTransfer(id);
  if (!transfer) {
    throw new Error(`Transfer "${id}" not found or already expired.`);
  }

  const file = resolveTransferFileForDelete(transfer.files, selector);
  if (!file) {
    throw new Error(`No file matched "${selector}" in transfer "${id}".`);
  }

  onProgress?.(`Deleting objects for ${file.filename}...`);
  const result = await runTransferOperation((transfers) =>
    transfers.removeFile({ id, fileId: file.id, token: transfer.deleteToken }),
  );
  if (result.status === "deleted") {
    onProgress?.("Deleted last file; transfer removed.");
    return { deletedObjects: result.deletedObjects, deletedTransfer: true, file };
  }
  if (result.status !== "updated") {
    throw new Error(
      result.status === "unauthorised"
        ? `Transfer "${id}" could not authorize its delete token.`
        : `Transfer "${id}" or file "${selector}" is no longer available.`,
    );
  }
  onProgress?.("Done.");
  return {
    deletedObjects: result.deletedObjects,
    deletedTransfer: false,
    file,
    transfer: result.transfer,
  };
}

async function getTransferMediaStatus(): Promise<TransferMediaStatusResult> {
  requireRedis();
  const [queueLength, worker] = await Promise.all([
    getTransferMediaQueueLength().catch(() => 0),
    getTransferMediaWorkerStatus().catch(() => ({})),
  ]);

  return { queueLength, worker };
}

async function drainTransferMediaQueue(limit = 8): Promise<{
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
  queueLength: number;
}> {
  requireRedis();
  return runMediaEffect(
    Effect.gen(function* () {
      const result = yield* (yield* MediaWorkerService).drain(limit);
      const queueLength = yield* (yield* TransferMediaOperationsService).queueLength;
      return { ...result, queueLength };
    }),
  );
}

async function reconcileTransferMedia(
  onProgress?: (msg: string) => void,
): Promise<ReconcileTransferMediaResult> {
  requireRedis();
  onProgress?.("Reconciling active transfers...");
  const result = await runMediaEffect(
    Effect.gen(function* () {
      const media = yield* TransferMediaOperationsService;
      const reconciled = yield* media.reconcile;
      const queueLength = yield* media.queueLength;
      return { reconciled, queueLength };
    }),
  );
  return {
    scannedTransfers: result.reconciled.transfersScanned,
    updatedTransfers: result.reconciled.transfersRepaired,
    queueLength: result.queueLength,
  };
}

async function clearTransferMediaQueue(): Promise<ClearTransferMediaQueueResult> {
  requireRedis();
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* TransferMediaOperationsService).clearQueue;
    }),
  );
}

async function retryTransferMedia(
  id: string,
  selector?: string,
): Promise<RetryTransferMediaResult> {
  requireRedis();

  if (!isSafeTransferId(id)) {
    throw new Error("Invalid transfer id");
  }

  const transfer = await getTransfer(id);
  if (!transfer) throw new Error(`Transfer "${id}" not found or expired.`);
  const beforeTarget = selector
    ? resolveTransferFileForDelete(transfer.files, selector)
    : undefined;
  if (selector && !beforeTarget)
    throw new Error(`No file matched "${selector}" in transfer "${id}".`);
  const result = selector
    ? await runMediaEffect(
        Effect.gen(function* () {
          return yield* (yield* TransferMediaOperationsService).retry({
            transferId: id,
            mediaId: beforeTarget?.id,
          });
        }),
      )
    : await runMediaEffect(
        Effect.gen(function* () {
          return yield* (yield* TransferMediaOperationsService).backfill(id);
        }),
      );
  if (result.status !== "completed") {
    throw new Error(`Transfer "${id}" is no longer available for retry.`);
  }
  const queueLength = await runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* TransferMediaOperationsService).queueLength;
    }),
  );

  return {
    transferId: id,
    ...(selector ? { selector } : {}),
    requeued: "requeued" in result ? result.requeued : result.changed,
    fileCount: "fileCount" in result ? result.fileCount : transfer.files.length,
    queueLength,
    ...(result.status === "completed" && "mediaId" in result
      ? {
          target: {
            id: result.mediaId,
            filename: result.filename,
            processingStatus: result.processingStatus,
            retryCount: result.retryCount,
          },
        }
      : {}),
  };
}

/**
 * Cleanup expired/orphaned transfers without touching active ones.
 */
async function cleanupExpiredTransfers(
  onProgress?: (msg: string) => void,
): Promise<{ expiredIndexEntries: number; scannedPrefixes: number; deletedObjects: number }> {
  requireRedis();
  requireR2();
  onProgress?.("Scanning transfer metadata and object storage...");
  const { mode: _mode, ...result } = await runTransferOperation((transfers) =>
    transfers.cleanup("deep"),
  );
  return result;
}

/**
 * Nuke all transfers: wipe every R2 object under transfers/ and
 * clear the Redis index + all transfer:* keys. Full reset.
 */
async function nukeAllTransfers(
  onProgress?: (msg: string) => void,
): Promise<{ deletedFiles: number; deletedKeys: number }> {
  requireRedis();
  requireR2();
  onProgress?.("Deleting transfer objects and metadata...");
  const result = await runTransferOperation((transfers) => transfers.nuke);
  if (!result.configured) throw new Error("Transfer storage is not configured.");
  onProgress?.("Done.");
  return { deletedFiles: result.deletedFiles, deletedKeys: result.deletedTransfers };
}

export {
  createTransfer,
  appendToTransfer,
  getTransferInfo,
  listActiveTransfers,
  deleteTransfer,
  deleteTransferFile,
  cleanupExpiredTransfers,
  getTransferMediaStatus,
  drainTransferMediaQueue,
  clearTransferMediaQueue,
  reconcileTransferMedia,
  retryTransferMedia,
  nukeAllTransfers,
  formatDuration,
  parseExpiry,
};

export type { CreateTransferOpts, CreateTransferResult, AppendTransferOpts, AppendTransferResult };
