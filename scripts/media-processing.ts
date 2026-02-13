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

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import sharp from "sharp";
import exifReader from "exif-reader";

/* ─── Constants ─── */

const THUMB_WIDTH = 600;
const FULL_WIDTH = 1600;
/** OG image dimensions — 1200×630 fills standard social cards */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** Percentage-based focal point for OG crop. Passed in by callers (album-ops resolves presets + auto-detect). */
type FocalPercent = { x: number; y: number };

/** Image extensions Sharp can process (HEIC/HIF need libheif in Sharp build) */
const PROCESSABLE_EXTENSIONS = /\.(jpe?g|png|webp|heic|hif|tiff?)$/i;

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
  ".heic": "image/heic", ".hif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff",
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

/* ─── OG crop helper ─── */

/**
 * Resize + crop to OG dimensions using percentage-based focal point.
 * Scales the image to fill 1200×630, then extracts the crop region
 * at the position determined by (x%, y%).
 */
async function cropToOg(
  raw: Buffer,
  focal: { x: number; y: number } = { x: 50, y: 50 }
): Promise<sharp.Sharp> {
  const meta = await sharp(raw).metadata();
  const srcW = meta.width ?? 4032;
  const srcH = meta.height ?? 3024;

  const scale = Math.max(OG_WIDTH / srcW, OG_HEIGHT / srcH);
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);

  const maxLeft = scaledW - OG_WIDTH;
  const maxTop = scaledH - OG_HEIGHT;
  const left = Math.min(maxLeft, Math.max(0, Math.round(maxLeft * (focal.x / 100))));
  const top = Math.min(maxTop, Math.max(0, Math.round(maxTop * (focal.y / 100))));

  return sharp(raw)
    .resize(scaledW, scaledH)
    .extract({ left, top, width: OG_WIDTH, height: OG_HEIGHT });
}

/* ─── OG text overlay ─── */

/** Text to burn into the OG image via SVG composite */
type OgOverlay = {
  /** Album title */
  title: string;
  /** Individual photo ID — shown bottom-right (omit for album cover OG) */
  photoId?: string;
};

/** Escape special XML characters for safe SVG text content */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build an SVG overlay for the OG image.
 * Bottom gradient + "milk & henny · {title}" left, optional photoId right.
 * Matches the editorial typewriter design language.
 */
function buildOgOverlaySvg(overlay: OgOverlay): Buffer {
  const brand = "milk &amp; henny";
  const title = escapeXml(overlay.title);
  const photoId = overlay.photoId ? escapeXml(overlay.photoId) : "";

  const textY = OG_HEIGHT - 44;
  const svg = `<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${Math.round(OG_HEIGHT * 0.58)}" width="${OG_WIDTH}" height="${Math.round(OG_HEIGHT * 0.42)}" fill="url(#g)"/>
  <text x="48" y="${textY}" font-size="28" font-weight="600" fill="rgba(255,255,255,0.96)" stroke="rgba(0,0,0,0.35)" stroke-width="1" paint-order="stroke fill" font-family="'Courier New', Courier, monospace" letter-spacing="-0.4">${brand} · ${title}</text>${
    photoId
      ? `\n  <text x="${OG_WIDTH - 48}" y="${textY}" font-size="22" font-weight="600" fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.35)" stroke-width="1" paint-order="stroke fill" font-family="'Courier New', Courier, monospace" text-anchor="end">${photoId}</text>`
      : ""
  }
</svg>`;

  return Buffer.from(svg);
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

/* ─── HEIC/HIF fallback (when Sharp has no libheif) ─── */

const HEIF_EXTENSIONS = [".heic", ".hif"];

function isHeifExtension(ext: string): boolean {
  return HEIF_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * Convert HEIC/HIF buffer to JPEG using macOS sips (no extra deps).
 * Uses the given extension for the temp file so sips recognizes .heic vs .hif.
 * Returns null if not macOS, sips fails, or conversion fails.
 */
function convertHeifToJpegWithSips(raw: Buffer, ext: string): Buffer | null {
  if (process.platform !== "darwin") return null;

  const tmpDir = os.tmpdir();
  const suffix = ext.toLowerCase() === ".hif" ? ".hif" : ".heic";
  const inPath = path.join(tmpDir, `heif-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  const outPath = path.join(tmpDir, `heif-out-${Date.now()}.jpg`);

  try {
    fs.writeFileSync(inPath, raw);
    const result = spawnSync("sips", ["-s", "format", "jpeg", inPath, "--out", outPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return null;
    if (!fs.existsSync(outPath)) return null;
    const jpeg = fs.readFileSync(outPath);
    return jpeg;
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/** User-facing error when HEIC/HIF can't be decoded */
function heifDecodeError(ext: string): Error {
  return new Error(
    `Could not decode ${ext.toUpperCase()} image. ` +
      (process.platform === "darwin"
        ? "Sharp has no HEIF support and sips conversion failed. Try opening and re-exporting as JPEG in Preview."
        : "Install Sharp with libheif support, or convert to JPEG/PNG before upload.")
  );
}

/* ─── Processing ─── */

/**
 * Process a raw image buffer into thumb + full + original variants.
 *
 * - thumb: 600px WebP (gallery grids)
 * - full: 1600px WebP (lightbox viewing)
 * - original: source converted to JPEG 95 for downloads (passthrough if already JPEG)
 *
 * HEIC/HIF: If Sharp fails to decode (no libheif), we try macOS sips to convert to JPEG first.
 *
 * Used by album-ops and transfer-ops.
 */
async function processImageVariants(
  raw: Buffer,
  sourceExt: string,
  focalPercent?: FocalPercent,
  ogOverlay?: OgOverlay
): Promise<ProcessedImage> {
  const ext = sourceExt.toLowerCase();

  const run = async (buffer: Buffer, isJpegSource: boolean) => {
    // Auto-rotate from EXIF orientation first, then read true dimensions
    const rotated = await sharp(buffer).rotate().toBuffer();
    const metadata = await sharp(rotated).metadata();
    const width = metadata.width ?? 4032;
    const height = metadata.height ?? 3024;
    const takenAt = extractExifDate(
      // EXIF lives in the original buffer; rotated buffer may strip it
      (await sharp(buffer).metadata()).exif
    );

    const thumb = await sharp(rotated)
      .resize(THUMB_WIDTH)
      .webp({ quality: 80 })
      .toBuffer();

    const full = await sharp(rotated)
      .resize(FULL_WIDTH)
      .webp({ quality: 85 })
      .toBuffer();

    const originalBuffer = isJpegSource
      ? rotated
      : await sharp(rotated).jpeg({ quality: 95 }).toBuffer();

    let ogPipeline = await cropToOg(rotated, focalPercent);
    if (ogOverlay) {
      ogPipeline = ogPipeline.composite([{ input: buildOgOverlaySvg(ogOverlay) }]);
    }
    const og = await ogPipeline.jpeg({ quality: 70, mozjpeg: true }).toBuffer();

    return {
      thumb: { buffer: thumb, contentType: "image/webp", ext: ".webp" },
      full: { buffer: full, contentType: "image/webp", ext: ".webp" },
      original: {
        buffer: originalBuffer,
        contentType: "image/jpeg",
        ext: isJpegSource ? ext : ".jpg",
      },
      og: { buffer: og, contentType: "image/jpeg", ext: ".jpg" },
      width,
      height,
      takenAt,
    };
  };

  try {
    return await run(raw, ext === ".jpg" || ext === ".jpeg");
  } catch (err) {
    if (isHeifExtension(ext)) {
      const jpeg = convertHeifToJpegWithSips(raw, ext);
      if (jpeg && jpeg.length > 0) {
        return run(jpeg, false);
      }
      throw heifDecodeError(ext);
    }
    throw err;
  }
}

/**
 * Create OG-sized JPEG from a raw image buffer.
 * Used by backfill and regen when re-processing from original.
 * @param focalPercent - Focal point as { x, y } percentages. Default: center (50, 50).
 */
async function processToOg(
  raw: Buffer,
  focalPercent?: FocalPercent,
  overlay?: OgOverlay
): Promise<ImageVariant> {
  // Auto-rotate from EXIF before cropping (originals from R2 may still have EXIF orientation)
  const rotated = await sharp(raw).rotate().toBuffer();
  let pipeline = await cropToOg(rotated, focalPercent);
  if (overlay) {
    pipeline = pipeline.composite([{ input: buildOgOverlaySvg(overlay) }]);
  }
  const buffer = await pipeline.jpeg({ quality: 70, mozjpeg: true }).toBuffer();
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
  const takenAt = extractExifDate((await sharp(raw).metadata()).exif);

  // Auto-rotate from EXIF orientation, then measure true dimensions
  const rotated = await sharp(raw).rotate().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const width = metadata.width ?? 4032;
  const height = metadata.height ?? 3024;

  // Only resize if wider than maxWidth
  const pipeline = width > maxWidth ? sharp(rotated).resize(maxWidth) : sharp(rotated);
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

export type { FileKind, ImageVariant, ProcessedImage, ProcessedGif, OgOverlay };
