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
import { promisify } from "util";
import sharp from "sharp";
import exifReader from "exif-reader";
import type { FileKind } from "./file-kinds";
import {
  RAW_PREVIEW_ACCEPTANCE_STEPS,
  RAW_PREVIEW_MAX_EMBEDDED_JPEG_CANDIDATES,
  RAW_PREVIEW_TARGET_LONGEST_EDGE,
} from "./raw-preview";
import { SITE_BRAND } from "@/lib/shared/config";

const execFileAsync = promisify(execFile);

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
  if (RAW_IMAGE_EXTENSIONS.test(ext)) return "image";
  if (VIDEO_EXTENSIONS.test(ext)) return "video";
  if (AUDIO_EXTENSIONS.test(ext)) return "audio";
  return "file";
}

/** Check if a filename is a processable image (Sharp-compatible) */
function isProcessableImage(filename: string): boolean {
  return PROCESSABLE_EXTENSIONS.test(filename) || RAW_IMAGE_EXTENSIONS.test(filename);
}

class RawPreviewUnavailableError extends Error {
  constructor(sourceExt: string, reason: "missing" | "too_small" | "monochrome") {
    super(
      reason === "too_small"
        ? `Embedded preview below minimum resolution for ${sourceExt} image`
        : reason === "monochrome"
          ? `Embedded preview is monochrome for ${sourceExt} image`
        : `No usable embedded preview found in ${sourceExt} image`
    );
    this.name = "RawPreviewUnavailableError";
  }
}

function normalizePreviewBuffer(preview: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(preview)
    ? preview
    : Buffer.from(preview.buffer, preview.byteOffset, preview.byteLength);
}

async function isValidJpegBuffer(candidate: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(candidate).metadata();
    return typeof metadata.width === "number" && typeof metadata.height === "number";
  } catch {
    return false;
  }
}

function channelsLookMonochrome(
  channels: Array<{ mean: number; stdev: number; min: number; max: number }>
): boolean {
  if (channels.length < 3) return true;
  const [r, g, b] = channels;
  const epsilon = 0.5;
  return (
    Math.abs(r.mean - g.mean) < epsilon &&
    Math.abs(r.mean - b.mean) < epsilon &&
    Math.abs(r.stdev - g.stdev) < epsilon &&
    Math.abs(r.stdev - b.stdev) < epsilon &&
    Math.abs(r.min - g.min) < epsilon &&
    Math.abs(r.min - b.min) < epsilon &&
    Math.abs(r.max - g.max) < epsilon &&
    Math.abs(r.max - b.max) < epsilon
  );
}

function resolveAcceptedRawPreviewThreshold(longestEdge: number): number | null {
  for (const threshold of RAW_PREVIEW_ACCEPTANCE_STEPS) {
    if (longestEdge >= threshold) return threshold;
  }
  return null;
}

type RawPreviewCandidate = {
  buffer: Buffer;
  width: number;
  height: number;
  longestEdge: number;
  byteLength: number;
};

function compareRawPreviewCandidates(a: RawPreviewCandidate, b: RawPreviewCandidate): number {
  if (a.longestEdge !== b.longestEdge) return b.longestEdge - a.longestEdge;
  if (a.width !== b.width) return b.width - a.width;
  if (a.height !== b.height) return b.height - a.height;
  return b.byteLength - a.byteLength;
}

function isTargetQualityRawPreview(candidate: Pick<RawPreviewCandidate, "longestEdge">): boolean {
  return candidate.longestEdge >= RAW_PREVIEW_TARGET_LONGEST_EDGE;
}

async function inspectRawPreviewBuffer(
  preview: Buffer | Uint8Array,
  sourceExt: string
): Promise<RawPreviewCandidate> {
  const buffer = normalizePreviewBuffer(preview);
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const longestEdge = Math.max(width, height);
  const acceptedThreshold = resolveAcceptedRawPreviewThreshold(longestEdge);

  if (acceptedThreshold === null) {
    throw new RawPreviewUnavailableError(sourceExt, "too_small");
  }
  const stats = await sharp(buffer).stats();
  if (
    metadata.space === "b-w" ||
    metadata.channels === 1 ||
    channelsLookMonochrome(stats.channels)
  ) {
    throw new RawPreviewUnavailableError(sourceExt, "monochrome");
  }

  return {
    buffer,
    width,
    height,
    longestEdge,
    byteLength: buffer.byteLength,
  };
}

async function resolveExifrRawPreview(raw: Buffer, sourceExt: string): Promise<RawPreviewCandidate | null> {
  const exifr = (await import("exifr")).default;
  const preview = await exifr.thumbnail(raw);
  if (!preview) return null;
  return inspectRawPreviewBuffer(preview, sourceExt);
}

async function extractEmbeddedJpegPreview(raw: Buffer, sourceExt: string): Promise<RawPreviewCandidate | null> {
  const candidates: Array<{ start: number; end: number; length: number }> = [];
  const minimumCandidateLength = 64;
  let jpegStart = -1;

  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i];
    const b = raw[i + 1];

    if (jpegStart === -1 && a === 0xff && b === 0xd8) {
      jpegStart = i;
      i += 1;
      continue;
    }

    if (jpegStart !== -1 && a === 0xff && b === 0xd9) {
      const end = i + 2;
      const length = end - jpegStart;
      if (length >= minimumCandidateLength) {
        candidates.push({ start: jpegStart, end, length });
      }
      jpegStart = -1;
      i += 1;
    }
  }

  candidates.sort((a, b) => b.length - a.length);
  let bestCandidate: RawPreviewCandidate | null = null;
  let inspectedCandidates = 0;

  for (const candidate of candidates) {
    const preview = raw.subarray(candidate.start, candidate.end);
    if (!await isValidJpegBuffer(preview)) continue;
    try {
      const inspected = await inspectRawPreviewBuffer(Buffer.from(preview), sourceExt);
      inspectedCandidates += 1;
      if (!bestCandidate || compareRawPreviewCandidates(inspected, bestCandidate) < 0) {
        bestCandidate = inspected;
      }
      if (
        (bestCandidate && isTargetQualityRawPreview(bestCandidate)) ||
        inspectedCandidates >= RAW_PREVIEW_MAX_EMBEDDED_JPEG_CANDIDATES
      ) {
        break;
      }
    } catch {
      continue;
    }
  }

  return bestCandidate;
}

type TiffReadContext = {
  littleEndian: boolean;
  bigTiff: boolean;
  offsetSize: 4 | 8;
  firstIfdOffset: number;
  entryCountSize: 2 | 8;
  entrySize: 12 | 20;
};

function hasClassicTiffHeader(raw: Buffer): boolean {
  return raw.length >= 8 && (
    (raw[0] === 0x49 && raw[1] === 0x49 && raw[2] === 0x2a && raw[3] === 0x00) ||
    (raw[0] === 0x4d && raw[1] === 0x4d && raw[2] === 0x00 && raw[3] === 0x2a)
  );
}

function getTiffContext(raw: Buffer): TiffReadContext | null {
  if (raw.length < 8) return null;
  if (raw[0] === 0x49 && raw[1] === 0x49) {
    if (raw[2] === 0x2a && raw[3] === 0x00) {
      return {
        littleEndian: true,
        bigTiff: false,
        offsetSize: 4,
        firstIfdOffset: readUint32(raw, 4, true),
        entryCountSize: 2,
        entrySize: 12,
      };
    }
    if (raw[2] === 0x2b && raw[3] === 0x00) {
      if (raw.length < 16 || raw[4] !== 8 || raw[5] !== 0 || raw[6] !== 0 || raw[7] !== 0) return null;
      const firstIfdOffset = readUint64(raw, 8, true);
      if (firstIfdOffset === null) return null;
      return {
        littleEndian: true,
        bigTiff: true,
        offsetSize: 8,
        firstIfdOffset,
        entryCountSize: 8,
        entrySize: 20,
      };
    }
    return null;
  }
  if (raw[0] === 0x4d && raw[1] === 0x4d) {
    if (raw[2] === 0x00 && raw[3] === 0x2a) {
      return {
        littleEndian: false,
        bigTiff: false,
        offsetSize: 4,
        firstIfdOffset: readUint32(raw, 4, false),
        entryCountSize: 2,
        entrySize: 12,
      };
    }
    if (raw[2] === 0x00 && raw[3] === 0x2b) {
      if (raw.length < 16 || raw[4] !== 0 || raw[5] !== 8 || raw[6] !== 0 || raw[7] !== 0) return null;
      const firstIfdOffset = readUint64(raw, 8, false);
      if (firstIfdOffset === null) return null;
      return {
        littleEndian: false,
        bigTiff: true,
        offsetSize: 8,
        firstIfdOffset,
        entryCountSize: 8,
        entrySize: 20,
      };
    }
    return null;
  }
  return null;
}

function readUint16(raw: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? raw.readUInt16LE(offset) : raw.readUInt16BE(offset);
}

function readUint32(raw: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset);
}

function readUint64(raw: Buffer, offset: number, littleEndian: boolean): number | null {
  const value = littleEndian ? raw.readBigUInt64LE(offset) : raw.readBigUInt64BE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function readTiffNumber(raw: Buffer, offset: number, byteSize: 2 | 4 | 8, littleEndian: boolean): number | null {
  if (offset < 0 || offset + byteSize > raw.length) return null;
  if (byteSize === 2) return readUint16(raw, offset, littleEndian);
  if (byteSize === 4) return readUint32(raw, offset, littleEndian);
  return readUint64(raw, offset, littleEndian);
}

function readInlineTiffValue(
  raw: Buffer,
  offset: number,
  littleEndian: boolean,
  type: number,
  valueFieldSize: 4 | 8
): number | null {
  if (type === 3) return readTiffNumber(raw, offset, 2, littleEndian);
  return readTiffNumber(raw, offset, valueFieldSize, littleEndian);
}

function extractDngPreviewFromTiff(raw: Buffer): Buffer | null {
  const ctx = getTiffContext(raw);
  if (!ctx) return null;

  const entryValueSizeByType: Record<number, number> = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    13: 4,
    16: 8,
    17: 8,
    18: 8,
  };
  const visited = new Set<number>();
  const queue: number[] = [ctx.firstIfdOffset];
  let bestCandidate: Buffer | null = null;

  while (queue.length > 0) {
    const ifdOffset = queue.shift() ?? 0;
    if (ifdOffset <= 0 || visited.has(ifdOffset)) continue;
    visited.add(ifdOffset);
    if (ifdOffset + ctx.entryCountSize > raw.length) continue;

    const entryCount = readTiffNumber(raw, ifdOffset, ctx.entryCountSize, ctx.littleEndian);
    if (entryCount === null) continue;
    const entriesOffset = ifdOffset + ctx.entryCountSize;
    const nextIfdOffsetPos = entriesOffset + entryCount * ctx.entrySize;
    if (nextIfdOffsetPos + ctx.offsetSize > raw.length) continue;

    let jpegOffset: number | null = null;
    let jpegLength: number | null = null;

    for (let i = 0; i < entryCount; i++) {
      const entryOffset = entriesOffset + i * ctx.entrySize;
      if (entryOffset + ctx.entrySize > raw.length) break;

      const tag = readUint16(raw, entryOffset, ctx.littleEndian);
      const type = readUint16(raw, entryOffset + 2, ctx.littleEndian);
      const count = readTiffNumber(raw, entryOffset + 4, ctx.entryCountSize, ctx.littleEndian);
      if (count === null) continue;
      const valueOrOffset = entryOffset + 4 + ctx.entryCountSize;

      if (tag === 0x0201) {
        jpegOffset = readInlineTiffValue(raw, valueOrOffset, ctx.littleEndian, type, ctx.offsetSize);
        continue;
      }

      if (tag === 0x0202) {
        jpegLength = readInlineTiffValue(raw, valueOrOffset, ctx.littleEndian, type, ctx.offsetSize);
        continue;
      }

      if (tag === 0x014a && count > 0) {
        const valueSize = entryValueSizeByType[type] ?? 0;
        if (valueSize === 0) continue;
        const totalBytes = valueSize * count;
        const baseOffset =
          totalBytes <= ctx.offsetSize
            ? valueOrOffset
            : readTiffNumber(raw, valueOrOffset, ctx.offsetSize, ctx.littleEndian);

        if (baseOffset === null || baseOffset <= 0 || baseOffset + totalBytes > raw.length) continue;

        for (let j = 0; j < count; j++) {
          const subIfdOffset =
            type === 3
              ? readTiffNumber(raw, baseOffset + j * valueSize, 2, ctx.littleEndian)
              : readTiffNumber(raw, baseOffset + j * valueSize, ctx.offsetSize, ctx.littleEndian);
          if (subIfdOffset && subIfdOffset > 0 && !visited.has(subIfdOffset)) queue.push(subIfdOffset);
        }
      }
    }

    if (
      jpegOffset !== null &&
      jpegLength !== null &&
      jpegOffset > 0 &&
      jpegLength > 0 &&
      jpegOffset + jpegLength <= raw.length
    ) {
      const candidate = raw.subarray(jpegOffset, jpegOffset + jpegLength);
      if (!bestCandidate || candidate.length > bestCandidate.length) {
        bestCandidate = Buffer.from(candidate);
      }
    }

    const nextIfdOffset = readTiffNumber(raw, nextIfdOffsetPos, ctx.offsetSize, ctx.littleEndian);
    if (nextIfdOffset && nextIfdOffset > 0 && !visited.has(nextIfdOffset)) queue.push(nextIfdOffset);
  }

  return bestCandidate;
}

async function resolveLegacyRawPreview(raw: Buffer, sourceExt: string): Promise<RawPreviewCandidate | null> {
  const candidates: RawPreviewCandidate[] = [];
  const tiffPreview = hasClassicTiffHeader(raw) ? extractDngPreviewFromTiff(raw) : null;
  if (tiffPreview && await isValidJpegBuffer(tiffPreview)) {
    try {
      const inspected = await inspectRawPreviewBuffer(tiffPreview, sourceExt);
      if (isTargetQualityRawPreview(inspected)) return inspected;
      candidates.push(inspected);
    } catch {
      // Ignore invalid previews and keep checking other candidates.
    }
  }

  const embeddedPreview = await extractEmbeddedJpegPreview(raw, sourceExt);
  if (embeddedPreview) {
    candidates.push(embeddedPreview);
  }

  if (candidates.length === 0) return null;
  return candidates.sort(compareRawPreviewCandidates)[0] ?? null;
}

async function resolveRawPreview(raw: Buffer, sourceExt: string): Promise<Buffer> {
  const candidates: RawPreviewCandidate[] = [];
  try {
    const exifrPreview = await resolveExifrRawPreview(raw, sourceExt);
    if (exifrPreview) {
      if (isTargetQualityRawPreview(exifrPreview)) return exifrPreview.buffer;
      candidates.push(exifrPreview);
    }
  } catch {
    // Try the legacy extractor before falling back to original-only.
  }

  const legacyPreview = await resolveLegacyRawPreview(raw, sourceExt);
  if (legacyPreview) candidates.push(legacyPreview);

  if (candidates.length > 0) {
    return candidates.sort(compareRawPreviewCandidates)[0]!.buffer;
  }

  throw new RawPreviewUnavailableError(sourceExt, "missing");
}

async function resolveImageProcessingSource(
  raw: Buffer,
  sourceExt: string
): Promise<{ buffer: Buffer; takenAt: string | null }> {
  if (RAW_IMAGE_EXTENSIONS.test(sourceExt)) {
    const preview = await resolveRawPreview(raw, sourceExt);
    const takenAt = extractExifDate((await sharp(preview).metadata()).exif);
    return { buffer: preview, takenAt };
  }

  const takenAt = extractExifDate((await sharp(raw).metadata()).exif);
  return { buffer: raw, takenAt };
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

type DecodedRawImage = {
  buffer: Buffer;
  width: number;
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
 *   HEIC/HIF           → HEIF container `irot`  → libvips/libheif applies at decode
 *
 * Sharp 0.33+ ships with libheif on all platforms via npm. No OS-specific tools needed.
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
  const [thumb, full, blur, originalBuffer, og] = await Promise.all([
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

  const parsed = JSON.parse(stdout) as {
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

async function applyBaselineExposure(
  pipeline: sharp.Sharp,
  rawBuffer: Buffer
): Promise<sharp.Sharp> {
  try {
    const exifr = await import("exifr");
    const tags = await exifr.parse(rawBuffer, {
      tiff: true,
      ifd0: { pick: ["BaselineExposure"] },
      exif: false,
      gps: false,
    });
    const baselineEV =
      tags && typeof tags === "object" && "BaselineExposure" in tags
        ? Number((tags as { BaselineExposure?: number }).BaselineExposure ?? 0)
        : 0;

    if (Number.isFinite(baselineEV) && Math.abs(baselineEV) > 0.05) {
      // DNG baseline exposure is compensation metadata, so apply the inverse gain here.
      return pipeline.linear(Math.pow(2, -baselineEV), 0);
    }
  } catch {
    // Ignore missing tags and parser errors; fallback decode should still succeed.
  }

  return pipeline;
}

async function processRawWithDcraw(raw: Buffer, sourceExtOrFilename = ".dng"): Promise<DecodedRawImage> {
  const ext = path.extname(sourceExtOrFilename).toLowerCase() || sourceExtOrFilename.toLowerCase();
  return withTempFile("transfer-raw", ext, raw, async (tempFile) => {
    const isDng = ext === ".dng";
    const input = sharp(tempFile, { failOn: "none", unlimited: true }).rotate();
    const metadata = await input.metadata();
    const isLinearScrgb = metadata.space === "scrgb";
    let pipeline = input;

    if (isLinearScrgb) {
      pipeline = pipeline.pipelineColourspace("scrgb");
      if (isDng) {
        pipeline = await applyBaselineExposure(pipeline, raw);
      }
      pipeline = pipeline.toColourspace("srgb");
    }

    const buffer = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
    if (buffer.length === 0) {
      throw new Error("Failed to decode raw image");
    }

    const renderedMetadata = await sharp(buffer).metadata();
    const width = renderedMetadata.width ?? 0;
    const height = renderedMetadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error("Decoded raw image has invalid dimensions");
    }

    return { buffer, width, height };
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
  RAW_IMAGE_EXTENSIONS,
  ANIMATED_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  MIME_TYPES,
  ROTATION_OVERRIDES,
  RAW_PREVIEW_ACCEPTANCE_STEPS,
  RawPreviewUnavailableError,
  getMimeType,
  getFileKind,
  isProcessableImage,
  extractExifDate,
  generateBlurDataUri,
  processImageVariants,
  processToOg,
  processGifThumb,
  processRawWithDcraw,
  processVideoVariants,
  processToWebP,
  mapConcurrent,
};

export type { ImageVariant, ProcessedImage, ProcessedGif, ProcessedVideo, DecodedRawImage, OgOverlay, RotationOverride };
