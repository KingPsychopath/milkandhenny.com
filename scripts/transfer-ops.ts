/**
 * Transfer business logic.
 *
 * Handles file processing, R2 upload/delete, and Redis metadata
 * for temporary private transfers. Supports images, videos, GIFs,
 * audio, documents, archives — anything you throw at it.
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import exifReader from "exif-reader";
import {
  uploadBuffer,
  deleteObjects,
  listObjects,
} from "./r2-client";
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

/* ─── Constants ─── */

const THUMB_WIDTH = 600;
const FULL_WIDTH = 1600;

/** Images that Sharp can process into thumb/full/original */
const PROCESSABLE_IMAGES = /\.(jpe?g|png|webp|heic|tiff?)$/i;

/** Animated images — get a static thumbnail but original stays as-is */
const ANIMATED_IMAGES = /\.gif$/i;

/** Video file extensions */
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv)$/i;

/** Audio file extensions */
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i;

/** MIME type lookup by extension */
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp",
  ".heic": "image/heic", ".tif": "image/tiff", ".tiff": "image/tiff",
  ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".webm": "video/webm", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".m4v": "video/mp4",
  ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".aac": "audio/aac", ".m4a": "audio/mp4", ".wma": "audio/x-ms-wma",
  ".pdf": "application/pdf",
  ".zip": "application/zip", ".rar": "application/x-rar-compressed",
  ".7z": "application/x-7z-compressed", ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain", ".csv": "text/csv",
  ".json": "application/json", ".xml": "application/xml",
};

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

/* ─── Helpers ─── */

function getMimeType(filename: string): string {
  return MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function getFileKind(filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ANIMATED_IMAGES.test(ext)) return "gif";
  if (PROCESSABLE_IMAGES.test(ext)) return "image";
  if (VIDEO_EXTENSIONS.test(ext)) return "video";
  if (AUDIO_EXTENSIONS.test(ext)) return "audio";
  return "file";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ─── EXIF helpers ─── */

function extractExifDate(exifBuffer: Buffer | undefined): string | null {
  if (!exifBuffer) return null;
  try {
    const exif = exifReader(exifBuffer);
    const date =
      exif?.Photo?.DateTimeOriginal ??
      exif?.Photo?.DateTimeDigitized ??
      exif?.Image?.DateTime ??
      null;
    if (date instanceof Date && !isNaN(date.getTime())) {
      return date.toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

/* ─── File processing ─── */

/**
 * Process and upload a processable image (JPEG, PNG, WebP, HEIC, TIFF).
 * Creates: thumb (600px WebP) + full (1600px WebP) + original.
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

  const metadata = await sharp(raw).metadata();
  const w = metadata.width ?? 4032;
  const h = metadata.height ?? 3024;
  const takenAt = extractExifDate(metadata.exif);

  onProgress?.(
    `Processing ${filename} (${w}×${h})${
      takenAt ? ` taken ${new Date(takenAt).toLocaleDateString()}` : ""
    }...`
  );

  const thumb = await sharp(raw).resize(THUMB_WIDTH).webp({ quality: 80 }).toBuffer();
  const full = await sharp(raw).resize(FULL_WIDTH).webp({ quality: 85 }).toBuffer();
  const original = (ext === ".jpg" || ext === ".jpeg")
    ? raw
    : await sharp(raw).jpeg({ quality: 95 }).toBuffer();

  const originalFilename = (ext === ".jpg" || ext === ".jpeg")
    ? filename
    : `${stem}.jpg`;

  const prefix = `transfers/${transferId}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${stem}.webp`, thumb, "image/webp"),
    uploadBuffer(`${prefix}/full/${stem}.webp`, full, "image/webp"),
    uploadBuffer(`${prefix}/original/${originalFilename}`, original, "image/jpeg"),
  ]);

  onProgress?.(`Uploaded ${filename}`);

  return {
    file: {
      id: stem,
      filename: originalFilename,
      kind: "image",
      size: raw.byteLength,
      mimeType: "image/jpeg",
      width: w,
      height: h,
      ...(takenAt ? { takenAt } : {}),
    },
    uploadedBytes: thumb.byteLength + full.byteLength + original.byteLength,
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

  // Extract first frame for thumbnail
  const metadata = await sharp(raw, { animated: false }).metadata();
  const w = metadata.width ?? 600;
  const h = metadata.height ?? 400;

  onProgress?.(`Processing ${filename} (GIF, ${w}×${h})...`);

  const thumb = await sharp(raw, { animated: false })
    .resize(THUMB_WIDTH)
    .webp({ quality: 80 })
    .toBuffer();

  const prefix = `transfers/${transferId}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${stem}.webp`, thumb, "image/webp"),
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
      width: w,
      height: h,
    },
    uploadedBytes: thumb.byteLength + raw.byteLength,
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

/* ─── Concurrency helper ─── */

/**
 * Run async tasks with a concurrency limit.
 * Like Promise.all but caps simultaneous execution to avoid
 * overwhelming the network or Sharp's thread pool.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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
  const images = entries.filter((f) => PROCESSABLE_IMAGES.test(f));
  const gifs = entries.filter((f) => ANIMATED_IMAGES.test(f));
  const others = entries.filter(
    (f) => !PROCESSABLE_IMAGES.test(f) && !ANIMATED_IMAGES.test(f)
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
