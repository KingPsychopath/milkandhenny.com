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
 * Used by album-ops, transfer-ops, words-media-ops, and API upload routes.
 */

import "server-only";

import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import exifReader from "exif-reader";
import type { FileKind } from "./file-kinds";
import { SITE_BRAND } from "@/lib/shared/config";

type ExecFileAsyncOptions = NonNullable<Parameters<typeof execFile>[2]>;
type ExecFileAsyncOutput = Buffer | string;
type ExifrModule = (typeof import("exifr"))["default"];

function execFileAsync(
  file: string,
  args: string[],
  options?: ExecFileAsyncOptions
): Promise<{ stdout: ExecFileAsyncOutput; stderr: ExecFileAsyncOutput }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options ?? {}, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function importExifr(): Promise<ExifrModule> {
  return (await import("exifr")).default;
}

/* ─── Constants ─── */

const THUMB_WIDTH = 600;
const FULL_WIDTH = 1600;
/** OG image dimensions — 1200×630 fills standard social cards */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** Percentage-based focal point for OG crop. Passed in by callers (album-ops resolves presets + auto-detect). */
type FocalPercent = { x: number; y: number };

/** Image extensions Sharp can process in the default server/runtime stack */
const PROCESSABLE_EXTENSIONS = /\.(jpe?g|png|webp|tiff?)$/i;

/** HEIF stills require a dedicated conversion path on the server */
const HEIF_EXTENSIONS = /\.(heic|heif|hif)$/i;

/** Camera RAW stills we should treat as visual media even without generated variants */
const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;

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
  ".dng": "image/x-adobe-dng", ".arw": "image/x-sony-arw",
  ".cr2": "image/x-canon-cr2", ".cr3": "image/x-canon-cr3",
  ".nef": "image/x-nikon-nef", ".orf": "image/x-olympus-orf",
  ".raf": "image/x-fuji-raf", ".rw2": "image/x-panasonic-rw2",
  ".raw": "image/x-raw",
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

/** Get MIME type from a filename, falling back to octet-stream */
function getMimeType(filename: string): string {
  return MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** Classify a filename into a FileKind */
function getFileKind(filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ANIMATED_EXTENSIONS.test(ext)) return "gif";
  if (PROCESSABLE_EXTENSIONS.test(ext)) return "image";
  if (HEIF_EXTENSIONS.test(ext)) return "image";
  if (RAW_IMAGE_EXTENSIONS.test(ext)) return "image";
  if (VIDEO_EXTENSIONS.test(ext)) return "video";
  if (AUDIO_EXTENSIONS.test(ext)) return "audio";
  return "file";
}

/** Check if a filename is a processable image (Sharp-compatible) */
function isProcessableImage(filename: string): boolean {
  return PROCESSABLE_EXTENSIONS.test(filename) || RAW_IMAGE_EXTENSIONS.test(filename);
}

/* ─── RAW processing ─── */

class RawPreviewUnavailableError extends Error {
  constructor(sourceExt: string, reason: string) {
    super(`RAW preview unavailable for ${sourceExt}: ${reason}`);
    this.name = "RawPreviewUnavailableError";
  }
}

/**
 * Extract the camera-embedded JPEG preview via exiftool.
 *
 * Tries `-PreviewImage` first (full-size, Sony/Canon/Nikon/Apple all
 * embed one), then falls back to `-ThumbnailImage`.
 *
 * exiftool is:
 * - Concurrent-safe (no database, no locks)
 * - Format-agnostic (ARW, DNG, CR3, NEF, RAF, …)
 * - Extracts the camera-ISP-rendered preview (correct gamma/color)
 */
async function extractPreviewWithExiftool(
  raw: Buffer,
  sourceExt: string
): Promise<Buffer> {
  const ext = sourceExt.startsWith(".") ? sourceExt : `.${sourceExt}`;

  return withTempFile("raw-preview", ext, raw, async (tempFile) => {
    const tags = ["-PreviewImage", "-JpgFromRaw", "-ThumbnailImage"];

    for (const tag of tags) {
      try {
        const { stdout } = await execFileAsync(
          "exiftool",
          ["-b", tag, tempFile],
          {
            encoding: "buffer",
            maxBuffer: 64 * 1024 * 1024,
          }
        );

        const buf = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(stdout);

        if (buf.length < 1000) continue;

        const meta = await sharp(buf).metadata();
        if (!meta.width || !meta.height) continue;
        if (Math.max(meta.width, meta.height) < 600) continue;

        return buf;
      } catch {
        continue;
      }
    }

    throw new RawPreviewUnavailableError(
      sourceExt,
      "no usable embedded preview found"
    );
  });
}

type DecodedRawImage = {
  buffer: Buffer;
  width: number;
  height: number;
};

/**
 * "Decode" a RAW file by extracting its embedded preview and
 * converting to JPEG. For callers that need a DecodedRawImage.
 */
async function processRawWithExiftool(
  raw: Buffer,
  sourceExtOrFilename = ".dng"
): Promise<DecodedRawImage> {
  const ext =
    path.extname(sourceExtOrFilename).toLowerCase() ||
    sourceExtOrFilename.toLowerCase();

  const preview = await extractPreviewWithExiftool(raw, ext);
  const { buffer: rotated, width, height } = await autoRotate(preview);
  const buffer = await sharp(rotated)
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  return { buffer, width, height };
}

/**
 * Resolve the best processing source for an image.
 *
 * For RAW: extract camera-rendered embedded preview via exiftool.
 * No BaselineExposure correction — the preview is already properly
 * tone-mapped by the camera ISP.
 *
 * For standard images: pass through as-is.
 */
async function resolveImageProcessingSource(
  raw: Buffer,
  sourceExt: string
): Promise<{ buffer: Buffer; takenAt: string | null }> {
  if (!RAW_IMAGE_EXTENSIONS.test(sourceExt)) {
    const takenAt = extractExifDate(
      (await sharp(raw).metadata()).exif
    );
    return { buffer: raw, takenAt };
  }

  const preview = await extractPreviewWithExiftool(raw, sourceExt);
  const takenAt = extractExifDate(
    (await sharp(preview).metadata()).exif
  );
  return { buffer: preview, takenAt };
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
 *
 * Colour audit: hex/rgba kept intentionally. This SVG is rendered server-side
 * (e.g. sharp) and consumed by OG crawlers; OKLCH in SVG is not universally
 * supported by all rasterizers. Use OKLCH in client CSS/Canvas only.
 */
function buildOgOverlaySvg(overlay: OgOverlay): Buffer {
  const brand = escapeXml(SITE_BRAND);
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
  /** Still-image Live Photo content identifier, if available. */
  livePhotoContentId?: string | null;
  /** Tiny base64 data URI for blur-up placeholder (~300 bytes) */
  blur: string;
};

type ProcessedGif = {
  /** Static first-frame WebP thumbnail */
  thumb: ImageVariant;
  /** Width of the GIF */
  width: number;
  /** Height of the GIF */
  height: number;
};

type ProcessedVideo = {
  /** WebP thumbnail at THUMB_WIDTH for gallery cards */
  thumb: ImageVariant;
  /** WebP poster at FULL_WIDTH for larger previews */
  full: ImageVariant;
  /** Source video dimensions */
  width: number;
  height: number;
  /** Duration in seconds if probe metadata is available */
  durationSeconds: number | null;
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

async function extractStillImageLivePhotoContentId(raw: Buffer): Promise<string | null> {
  try {
    const exifr = await importExifr();
    const tags = await exifr.parse(raw, {
      tiff: true,
      exif: true,
      xmp: true,
      gps: false,
      icc: false,
      iptc: false,
      jfif: false,
    });
    if (!tags || typeof tags !== "object") return null;
    for (const key of [
      "ContentIdentifier",
      "MediaGroupUUID",
      "AssetIdentifier",
      "assetIdentifier",
      "contentIdentifier",
    ] as const) {
      const value = tags[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/* ─── Rotation ─── */

/**
 * Optional manual rotation override. Applied before any processing.
 * - "portrait":  rotate 90° CW if the image is currently landscape
 * - "landscape": rotate 90° CW if the image is currently portrait
 * - undefined:   trust EXIF / HEIF orientation as-is (default)
 */
const ROTATION_OVERRIDES = ["portrait", "landscape"] as const;
type RotationOverride = (typeof ROTATION_OVERRIDES)[number];

/**
 * Auto-rotate from EXIF/HEIF orientation, then optionally force portrait/landscape.
 *
 * Rotation is handled entirely by Sharp (cross-platform):
 *   JPEG/PNG/TIFF/WebP → EXIF orientation tag  → `.rotate()` reads and applies
 *   HEIC/HIF           → requires a dedicated server/client HEIF decode path
 *
 * The default server/runtime stack intentionally does not assume HEIF support in Sharp.
 */
async function autoRotate(
  raw: Buffer,
  override?: RotationOverride,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  let rotated = await sharp(raw).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  let width = meta.width ?? 4032;
  let height = meta.height ?? 3024;

  if (override === "portrait" && width > height) {
    rotated = await sharp(rotated).rotate(90).toBuffer();
    [width, height] = [height, width];
  } else if (override === "landscape" && height > width) {
    rotated = await sharp(rotated).rotate(90).toBuffer();
    [width, height] = [height, width];
  }

  return { buffer: rotated, width, height };
}

/* ─── Blur placeholder ─── */

/** Tiny blur-up width — produces ~300 byte base64 data URIs */
const BLUR_WIDTH = 16;

/**
 * Generate a tiny base64 data URI for blur-up placeholders.
 * Produces a ~16px wide JPEG, blurred and converted to a data URI.
 * Typical output is 200–400 bytes — negligible in JSON/HTML.
 */
async function generateBlurDataUri(imageBuffer: Buffer): Promise<string> {
  const blurBuffer = await sharp(imageBuffer)
    .resize(BLUR_WIDTH)
    .blur(2)
    .jpeg({ quality: 40 })
    .toBuffer();
  return `data:image/jpeg;base64,${blurBuffer.toString("base64")}`;
}

/* ─── Processing ─── */

/**
 * Process a raw image buffer into thumb + full + original + og variants + blur placeholder.
 *
 * - thumb: 600px WebP (gallery grids)
 * - full: 1600px WebP (lightbox viewing)
 * - original: JPEG 95 for downloads (passthrough if already JPEG)
 * - og: 1200×630 JPEG for social sharing
 * - blur: tiny base64 data URI for instant placeholder (~300 bytes)
 *
 * All formats are handled cross-platform by Sharp (EXIF for JPEG/PNG/TIFF/WebP,
 * libheif for HEIC/HIF container rotation). Optional `rotationOverride` forces
 * portrait or landscape when EXIF data is missing or wrong.
 */
async function processImageVariants(
  raw: Buffer,
  sourceExt: string,
  focalPercent?: FocalPercent,
  ogOverlay?: OgOverlay,
  rotationOverride?: RotationOverride,
): Promise<ProcessedImage> {
  const ext = sourceExt.toLowerCase();
  const { buffer: processingSource, takenAt } = await resolveImageProcessingSource(raw, ext);
  const { buffer: rotated, width, height } = await autoRotate(processingSource, rotationOverride);

  // Generate all variants in parallel where possible
  const [thumb, full, blur, originalBuffer, og, livePhotoContentId] = await Promise.all([
    sharp(rotated).resize(THUMB_WIDTH).webp({ quality: 80 }).toBuffer(),
    sharp(rotated).resize(FULL_WIDTH).webp({ quality: 85 }).toBuffer(),
    generateBlurDataUri(rotated),
    ext === ".jpg" || ext === ".jpeg"
      ? Promise.resolve(rotated)
      : sharp(rotated).jpeg({ quality: 95 }).toBuffer(),
    (async () => {
      let ogPipeline = await cropToOg(rotated, focalPercent);
      if (ogOverlay) {
        ogPipeline = ogPipeline.composite([{ input: buildOgOverlaySvg(ogOverlay) }]);
      }
      return ogPipeline.jpeg({ quality: 70, mozjpeg: true }).toBuffer();
    })(),
    extractStillImageLivePhotoContentId(raw),
  ]);

  const isJpeg = ext === ".jpg" || ext === ".jpeg";

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
    ...(livePhotoContentId ? { livePhotoContentId } : {}),
    blur,
  };
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
  const { buffer: rotated } = await autoRotate(raw);
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

type VideoProbeResult = {
  width: number;
  height: number;
  durationSeconds: number | null;
};

function getVideoCaptureTimestamp(durationSeconds: number | null): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0.25) {
    return "0";
  }
  const seconds = Math.min(Math.max(durationSeconds * 0.1, 0.5), Math.max(0.5, durationSeconds / 2));
  return seconds.toFixed(3);
}

async function withTempFile<T>(
  prefix: string,
  ext: string,
  buffer: Buffer,
  fn: (filename: string) => Promise<T>
): Promise<T> {
  const tempFile = path.join(os.tmpdir(), `${prefix}-${randomUUID()}${ext}`);
  await fs.writeFile(tempFile, buffer);
  try {
    return await fn(tempFile);
  } finally {
    await fs.rm(tempFile, { force: true });
  }
}

async function canSharpReadImage(buffer: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(buffer, { failOn: "none", unlimited: true }).metadata();
    return (metadata.width ?? 0) > 0 && (metadata.height ?? 0) > 0;
  } catch {
    return false;
  }
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

async function probeVideoFile(filename: string): Promise<VideoProbeResult> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      filename,
    ],
    { maxBuffer: 1024 * 1024 }
  );

  const parsed = JSON.parse(
    typeof stdout === "string" ? stdout : stdout.toString("utf8")
  ) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;
  const durationValue = parsed.format?.duration ? Number(parsed.format.duration) : NaN;

  if (width <= 0 || height <= 0) {
    throw new Error("Unable to determine video dimensions");
  }

  return {
    width,
    height,
    durationSeconds: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null,
  };
}

async function extractVideoFrame(filename: string, timestamp: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "error",
      "-ss", timestamp,
      "-i", filename,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "png",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  const frame = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (frame.length === 0) {
    throw new Error("Failed to extract video preview frame");
  }
  return frame;
}

async function processVideoVariants(raw: Buffer, sourceExt = ".mp4"): Promise<ProcessedVideo> {
  const ext = sourceExt.startsWith(".") ? sourceExt : `.${sourceExt}`;
  return withTempFile("transfer-video", ext, raw, async (tempFile) => {
    const probe = await probeVideoFile(tempFile);
    const frame = await extractVideoFrame(tempFile, getVideoCaptureTimestamp(probe.durationSeconds));
    const { buffer: poster, width, height } = await autoRotate(frame);

    const [thumb, full] = await Promise.all([
      sharp(poster).resize(THUMB_WIDTH).webp({ quality: 80 }).toBuffer(),
      sharp(poster).resize(FULL_WIDTH).webp({ quality: 85 }).toBuffer(),
    ]);

    return {
      thumb: { buffer: thumb, contentType: "image/webp", ext: ".webp" },
      full: { buffer: full, contentType: "image/webp", ext: ".webp" },
      width,
      height,
      durationSeconds: probe.durationSeconds,
    };
  });
}

/**
 * Process a single image to a web-optimised WebP.
 * Simpler than processImageVariants — one output, not three.
 * Used for blog images where thumb/full/original split isn't needed.
 */
async function processToWebP(
  raw: Buffer,
  sourceExtOrFilename = ".jpg",
  maxWidth = FULL_WIDTH,
  quality = 85,
): Promise<{ buffer: Buffer; width: number; height: number; takenAt: string | null }> {
  const sourceExt = path.extname(sourceExtOrFilename).toLowerCase() || sourceExtOrFilename.toLowerCase();
  const { buffer: processingSource, takenAt } = await resolveImageProcessingSource(raw, sourceExt);
  const { buffer: rotated, width, height } = await autoRotate(processingSource);

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
  HEIF_EXTENSIONS,
  RAW_IMAGE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  MIME_TYPES,
  ROTATION_OVERRIDES,
  RawPreviewUnavailableError,
  getMimeType,
  getFileKind,
  isProcessableImage,
  extractExifDate,
  generateBlurDataUri,
  processImageVariants,
  processToOg,
  processGifThumb,
  processRawWithExiftool as processRawWithDcraw,
  processRawWithExiftool,
  extractPreviewWithExiftool as resolveRawPreview,
  extractPreviewWithExiftool,
  resolveImageProcessingSource,
  processVideoVariants,
  processToWebP,
  mapConcurrent,
};

export type { ImageVariant, ProcessedImage, ProcessedGif, ProcessedVideo, DecodedRawImage, OgOverlay, RotationOverride };
