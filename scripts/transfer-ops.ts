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
  uploadBuffer,
  deleteObjects,
  listObjects,
} from "./r2-client";
import {
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  getMimeType,
  getFileKind,
  formatBytes,
  processImageVariants,
  processGifThumb,
  mapConcurrent,
} from "./media-processing";
import { getRedis } from "../lib/redis";
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
} from "../lib/transfers";
import type { TransferData, TransferFile, TransferSummary, FileKind } from "../lib/transfers";

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

/**
 * Ensure R2 env vars are set before uploading files.
 */
function requireR2(): void {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
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

/* ─── File processing ─── */

/**
 * Process and upload a processable image (JPEG, PNG, WebP, HEIC, TIFF).
 * Creates: thumb (600px WebP) + full (1600px WebP) + original (JPEG).
 */
async function processImage(
  filePath: string,
  transferId: string,
  onProgress?: (msg: string) => void
): Promise<{ file: TransferFile; uploadedBytes: number }> {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const stem = path.basename(filePath, ext);
  const raw = fs.readFileSync(filePath);

  const processed = await processImageVariants(raw, ext);

  onProgress?.(
    `Processing ${filename} (${processed.width}×${processed.height})${
      processed.takenAt
        ? ` taken ${new Date(processed.takenAt).toLocaleDateString()}`
        : ""
    }...`
  );

  const originalFilename = processed.original.ext === ext
    ? filename
    : `${stem}${processed.original.ext}`;

  const prefix = `transfers/${transferId}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${stem}.webp`, processed.thumb.buffer, processed.thumb.contentType),
    uploadBuffer(`${prefix}/full/${stem}.webp`, processed.full.buffer, processed.full.contentType),
    uploadBuffer(`${prefix}/original/${originalFilename}`, processed.original.buffer, processed.original.contentType),
  ]);

  onProgress?.(`Uploaded ${filename}`);

  return {
    file: {
      id: stem,
      filename: originalFilename,
      kind: "image",
      size: raw.byteLength,
      mimeType: processed.original.contentType,
      width: processed.width,
      height: processed.height,
      ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
    },
    uploadedBytes:
      processed.thumb.buffer.byteLength +
      processed.full.buffer.byteLength +
      processed.original.buffer.byteLength,
  };
}

/**
 * Process and upload a GIF.
 * Creates: static thumb (first frame, WebP) + original GIF (preserves animation).
 */
async function processGif(
  filePath: string,
  transferId: string,
  onProgress?: (msg: string) => void
): Promise<{ file: TransferFile; uploadedBytes: number }> {
  const filename = path.basename(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  const raw = fs.readFileSync(filePath);

  const gif = await processGifThumb(raw);

  onProgress?.(`Processing ${filename} (GIF, ${gif.width}×${gif.height})...`);

  const prefix = `transfers/${transferId}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${stem}.webp`, gif.thumb.buffer, gif.thumb.contentType),
    uploadBuffer(`${prefix}/original/${filename}`, raw, "image/gif"),
  ]);

  onProgress?.(`Uploaded ${filename}`);

  return {
    file: {
      id: stem,
      filename,
      kind: "gif",
      size: raw.byteLength,
      mimeType: "image/gif",
      width: gif.width,
      height: gif.height,
    },
    uploadedBytes: gif.thumb.buffer.byteLength + raw.byteLength,
  };
}

/**
 * Upload a raw file (video, audio, document, archive, etc.) without processing.
 */
async function uploadRawFile(
  filePath: string,
  transferId: string,
  onProgress?: (msg: string) => void
): Promise<{ file: TransferFile; uploadedBytes: number }> {
  const filename = path.basename(filePath);
  const raw = fs.readFileSync(filePath);
  const mimeType = getMimeType(filename);
  const kind = getFileKind(filename);

  onProgress?.(`Uploading ${filename} (${formatBytes(raw.byteLength)}, ${kind})...`);

  await uploadBuffer(
    `transfers/${transferId}/original/${filename}`,
    raw,
    mimeType
  );

  onProgress?.(`Uploaded ${filename}`);

  return {
    file: {
      id: filename,
      filename,
      kind,
      size: raw.byteLength,
      mimeType,
    },
    uploadedBytes: raw.byteLength,
  };
}

/* ─── Transfer operations ─── */

/**
 * Concurrency settings for uploads.
 * - Images/GIFs: 3 concurrent (Sharp is CPU-heavy, each already does 2-3 parallel R2 puts)
 * - Raw files: 6 concurrent (no processing, purely network-bound)
 */
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

  // List ALL non-hidden files
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

  // Classify files
  const images = entries.filter((f) => PROCESSABLE_EXTENSIONS.test(f));
  const gifs = entries.filter((f) => ANIMATED_EXTENSIONS.test(f));
  const others = entries.filter(
    (f) => !PROCESSABLE_EXTENSIONS.test(f) && !ANIMATED_EXTENSIONS.test(f)
  );

  onProgress?.(
    `Found ${entries.length} files (${images.length} images, ${gifs.length} GIFs, ${others.length} other). Creating transfer ${transferId}...`
  );

  let totalSize = 0;

  // Process images concurrently (Sharp is CPU-heavy, so cap at 3)
  const imageResults = await mapConcurrent(images, IMAGE_CONCURRENCY, (file) =>
    processImage(path.join(absDir, file), transferId, onProgress)
  );

  // Process GIFs concurrently
  const gifResults = await mapConcurrent(gifs, IMAGE_CONCURRENCY, (file) =>
    processGif(path.join(absDir, file), transferId, onProgress)
  );

  // Upload raw files concurrently (no processing, pure network — cap at 6)
  const rawResults = await mapConcurrent(others, RAW_CONCURRENCY, (file) =>
    uploadRawFile(path.join(absDir, file), transferId, onProgress)
  );

  const allResults = [...imageResults, ...gifResults, ...rawResults];
  const files: TransferFile[] = allResults.map((r) => r.file);
  totalSize = allResults.reduce((sum, r) => sum + r.uploadedBytes, 0);

  // Sort: images/gifs by EXIF date then name, then non-visual files by name
  const visual = files.filter((f) => f.kind === "image" || f.kind === "gif");
  const nonVisual = files.filter((f) => f.kind !== "image" && f.kind !== "gif");
  visual.sort((a, b) => {
    if (a.takenAt && b.takenAt) return new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime();
    if (a.takenAt) return -1;
    if (b.takenAt) return 1;
    return a.filename.localeCompare(b.filename);
  });
  nonVisual.sort((a, b) => a.filename.localeCompare(b.filename));
  const sortedFiles = [...visual, ...nonVisual];

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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://milkandhenny.com";
  const shareUrl = `${baseUrl}/t/${transferId}`;
  const adminUrl = `${baseUrl}/t/${transferId}?token=${deleteToken}`;

  const fileCounts = {
    images: files.filter((f) => f.kind === "image").length,
    gifs: files.filter((f) => f.kind === "gif").length,
    videos: files.filter((f) => f.kind === "video").length,
    audio: files.filter((f) => f.kind === "audio").length,
    other: files.filter((f) => f.kind === "file").length,
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
  formatBytes,
};

export type { CreateTransferOpts, CreateTransferResult };
