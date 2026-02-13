/**
 * Shared media processing pipeline.
 *
 * Single source of truth for:
 * - Sharp image processing (thumb, full, WebP, original JPEG)
 * - GIF first-frame thumbnail extraction
 * - EXIF date extraction
 * - File type classification (MIME types, kind detection)
 * - Extension patterns for all supported media
 * - Concurrency helper
 *
 * Used by album-ops, transfer-ops, and blog-ops.
 */

import path from "path";
import sharp from "sharp";
import exifReader from "exif-reader";

/* ─── Constants ─── */

const THUMB_WIDTH = 600;
const FULL_WIDTH = 1600;
/** OG image dimensions — 1200×630 fills standard social cards */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** Image extensions Sharp can process */
const PROCESSABLE_EXTENSIONS = /\.(jpe?g|png|webp|heic|tiff?)$/i;

/** Animated images — get a static thumbnail but original stays as-is */
const ANIMATED_EXTENSIONS = /\.gif$/i;

/** Video file extensions */
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv)$/i;

/** Audio file extensions */
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i;

/** Comprehensive MIME type lookup by extension */
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

/* ─── File type classification ─── */

/** All the kinds a file can be — shared across transfers, blog, etc. */
const FILE_KINDS = ["image", "video", "gif", "audio", "file"] as const;
type FileKind = (typeof FILE_KINDS)[number];

/** Get MIME type from a filename, falling back to octet-stream */
function getMimeType(filename: string): string {
  return MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** Classify a filename into a FileKind */
function getFileKind(filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ANIMATED_EXTENSIONS.test(ext)) return "gif";
  if (PROCESSABLE_EXTENSIONS.test(ext)) return "image";
  if (VIDEO_EXTENSIONS.test(ext)) return "video";
  if (AUDIO_EXTENSIONS.test(ext)) return "audio";
  return "file";
}

/** Check if a filename is a processable image (Sharp-compatible) */
function isProcessableImage(filename: string): boolean {
  return PROCESSABLE_EXTENSIONS.test(filename);
}

/** Human-readable byte formatting */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ─── Types ─── */

type ImageVariant = {
  buffer: Buffer;
  contentType: string;
  /** File extension including the dot, e.g. ".webp" */
  ext: string;
};

type ProcessedImage = {
  /** WebP thumbnail at THUMB_WIDTH */
  thumb: ImageVariant;
  /** WebP full-size at FULL_WIDTH */
  full: ImageVariant;
  /** JPEG original (source converted to JPEG for consistent downloads) */
  original: ImageVariant;
  /** JPEG at OG_WIDTH×OG_HEIGHT for Open Graph / social sharing */
  og: ImageVariant;
  /** Original dimensions from Sharp metadata */
  width: number;
  height: number;
  /** ISO date from EXIF DateTimeOriginal, if available */
  takenAt: string | null;
};

type ProcessedGif = {
  /** Static first-frame WebP thumbnail */
  thumb: ImageVariant;
  /** Width of the GIF */
  width: number;
  /** Height of the GIF */
  height: number;
};

/* ─── EXIF ─── */

/** Extract the date a photo was taken from EXIF data, or null */
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

/* ─── Processing ─── */

/**
 * Process a raw image buffer into thumb + full + original variants.
 *
 * - thumb: 600px WebP (gallery grids)
 * - full: 1600px WebP (lightbox viewing)
 * - original: source converted to JPEG 95 for downloads (passthrough if already JPEG)
 *
 * Used by album-ops and transfer-ops.
 */
async function processImageVariants(
  raw: Buffer,
  sourceExt: string
): Promise<ProcessedImage> {
  const metadata = await sharp(raw).metadata();
  const width = metadata.width ?? 4032;
  const height = metadata.height ?? 3024;
  const takenAt = extractExifDate(metadata.exif);

  const thumb = await sharp(raw)
    .resize(THUMB_WIDTH)
    .webp({ quality: 80 })
    .toBuffer();

  const full = await sharp(raw)
    .resize(FULL_WIDTH)
    .webp({ quality: 85 })
    .toBuffer();

  const ext = sourceExt.toLowerCase();
  const isJpeg = ext === ".jpg" || ext === ".jpeg";
  const originalBuffer = isJpeg
    ? raw
    : await sharp(raw).jpeg({ quality: 95 }).toBuffer();

  const og = await sharp(raw)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();

  return {
    thumb: { buffer: thumb, contentType: "image/webp", ext: ".webp" },
    full: { buffer: full, contentType: "image/webp", ext: ".webp" },
    original: {
      buffer: originalBuffer,
      contentType: "image/jpeg",
      ext: isJpeg ? ext : ".jpg",
    },
    og: { buffer: og, contentType: "image/jpeg", ext: ".jpg" },
    width,
    height,
    takenAt,
  };
}

/**
 * Create OG-sized JPEG from a raw image buffer.
 * Used by backfill when re-processing from original.
 */
async function processToOg(raw: Buffer): Promise<ImageVariant> {
  const buffer = await sharp(raw)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { buffer, contentType: "image/jpeg", ext: ".jpg" };
}

/**
 * Extract a static first-frame thumbnail from an animated GIF.
 *
 * Returns the thumb buffer + GIF dimensions. The original GIF
 * should be uploaded as-is (animation preserved).
 *
 * Used by transfer-ops.
 */
async function processGifThumb(raw: Buffer): Promise<ProcessedGif> {
  const metadata = await sharp(raw, { animated: false }).metadata();
  const width = metadata.width ?? 600;
  const height = metadata.height ?? 400;

  const thumb = await sharp(raw, { animated: false })
    .resize(THUMB_WIDTH)
    .webp({ quality: 80 })
    .toBuffer();

  return {
    thumb: { buffer: thumb, contentType: "image/webp", ext: ".webp" },
    width,
    height,
  };
}

/**
 * Process a single image to a web-optimised WebP.
 * Simpler than processImageVariants — one output, not three.
 * Used for blog images where thumb/full/original split isn't needed.
 */
async function processToWebP(
  raw: Buffer,
  maxWidth = FULL_WIDTH,
  quality = 85
): Promise<{ buffer: Buffer; width: number; height: number; takenAt: string | null }> {
  const metadata = await sharp(raw).metadata();
  const width = metadata.width ?? 4032;
  const height = metadata.height ?? 3024;
  const takenAt = extractExifDate(metadata.exif);

  // Only resize if wider than maxWidth
  const pipeline = width > maxWidth ? sharp(raw).resize(maxWidth) : sharp(raw);
  const buffer = await pipeline.webp({ quality }).toBuffer();

  // Calculate output dimensions
  const outWidth = width > maxWidth ? maxWidth : width;
  const outHeight =
    width > maxWidth ? Math.round(height * (maxWidth / width)) : height;

  return { buffer, width: outWidth, height: outHeight, takenAt };
}

/**
 * Run async tasks with a concurrency limit.
 * Like Promise.all but caps simultaneous execution.
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

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export {
  THUMB_WIDTH,
  FULL_WIDTH,
  OG_WIDTH,
  OG_HEIGHT,
  PROCESSABLE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  MIME_TYPES,
  FILE_KINDS,
  getMimeType,
  getFileKind,
  isProcessableImage,
  formatBytes,
  extractExifDate,
  processImageVariants,
  processToOg,
  processGifThumb,
  processToWebP,
  mapConcurrent,
};

export type { FileKind, ImageVariant, ProcessedImage, ProcessedGif };
