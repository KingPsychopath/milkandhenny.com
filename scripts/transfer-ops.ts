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
  isConfigured,
} from "./r2-client";
import {
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  mapConcurrent,
} from "../lib/media/processing";
import { processTransferFile, sortTransferFiles } from "../lib/transfers/upload";
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
} from "../lib/transfers/store";
import type { TransferData, TransferSummary } from "../lib/transfers/store";

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

/* ─── Transfer operations ─── */

/** Images/GIFs: 3 concurrent (Sharp is CPU-heavy). Raw: 6 (network-bound). */
const IMAGE_CONCURRENCY = 3;
const RAW_CONCURRENCY = 6;

/** Create a new transfer: process files, upload to R2, save metadata to Redis */
async function createTransfer(
  opts: CreateTransferOpts,
  onProgress?: (msg: string) => void
): Promise<CreateTransferResult> {
  requireRedis();
  requireR2();

  const absDir = path.resolve(
    opts.dir.replace(/^~/, process.env.HOME ?? "~")
  );
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

  const transferId = generateTransferId();
  const deleteToken = generateDeleteToken();
  const ttlSeconds = opts.expires
    ? parseExpiry(opts.expires)
    : DEFAULT_EXPIRY_SECONDS;

  // Classify for concurrency control (Sharp is CPU-heavy)
  const heavy = entries.filter(
    (f) => PROCESSABLE_EXTENSIONS.test(f) || ANIMATED_EXTENSIONS.test(f)
  );
  const light = entries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f) && !ANIMATED_EXTENSIONS.test(f)
  );

  onProgress?.(
    `Found ${entries.length} files. Creating transfer ${transferId}...`
  );

  const processFile = async (file: string) => {
    const raw = fs.readFileSync(path.join(absDir, file));
    onProgress?.(`Processing ${file}...`);
    const result = await processTransferFile(raw, file, transferId);
    onProgress?.(`Uploaded ${file}`);
    return result;
  };

  const heavyResults = await mapConcurrent(heavy, IMAGE_CONCURRENCY, processFile);
  const lightResults = await mapConcurrent(light, RAW_CONCURRENCY, processFile);
  const allResults = [...heavyResults, ...lightResults];

  const sortedFiles = sortTransferFiles(allResults.map((r) => r.file));
  const totalSize = allResults.reduce((sum, r) => sum + r.uploadedBytes, 0);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const transfer: TransferData = {
    id: transferId,
    title: opts.title,
    files: sortedFiles,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deleteToken,
  };

  await saveTransfer(transfer, ttlSeconds);

  const shareUrl = `${BASE_URL}/t/${transferId}`;
  const adminUrl = `${BASE_URL}/t/${transferId}?token=${deleteToken}`;

  const fileCounts = {
    images: sortedFiles.filter((f) => f.kind === "image").length,
    gifs: sortedFiles.filter((f) => f.kind === "gif").length,
    videos: sortedFiles.filter((f) => f.kind === "video").length,
    audio: sortedFiles.filter((f) => f.kind === "audio").length,
    other: sortedFiles.filter((f) => f.kind === "file").length,
  };

  return { transfer, shareUrl, adminUrl, totalSize, fileCounts };
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
  getTransferInfo,
  listActiveTransfers,
  deleteTransfer,
  nukeAllTransfers,
  formatDuration,
  parseExpiry,
};

export type { CreateTransferOpts, CreateTransferResult };
