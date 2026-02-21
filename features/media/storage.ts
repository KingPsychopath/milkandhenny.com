/**
 * S3-compatible storage abstraction.
 * Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, etc.
 * To switch providers, change the env vars — zero code changes.
 */

import { R2_PUBLIC_URL } from "@/lib/shared/config";

/** Build the public URL for a file in the bucket */
function getImageUrl(path: string): string {
  return `${R2_PUBLIC_URL}/${path}`;
}

const DISALLOWED_SCHEMES = ["javascript:", "vbscript:", "data:"] as const;
const INTERNAL_ROUTE_PREFIXES = [
  "/pics/",
  "/words/",
  "/t/",
  "/party",
  "/upload",
  "/admin",
  "/api/",
  "/feed.xml",
] as const;

/* ─── Album URLs ─── */

/** Get the thumbnail URL for an album photo (WebP for fast loading) */
function getThumbUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/thumb/${photoId}.webp`);
}

/** Get the full-size viewing URL for an album photo (WebP for fast loading) */
function getFullUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/full/${photoId}.webp`);
}

/** Get the original (download) URL for an album photo */
function getOriginalUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/original/${photoId}.jpg`);
}

/** Get the OG-sized JPEG URL for Open Graph / social sharing */
function getOgUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/og/${photoId}.jpg`);
}

/* ─── Word media URLs ─── */

/** Get the URL for per-word media (stored at words/media/{slug}/{filename}) */
function getWordMediaUrl(slug: string, filename: string): string {
  return getImageUrl(`words/media/${slug}/${filename}`);
}

/** @deprecated Prefer getWordMediaUrl for type-agnostic naming. */
function getBlogImageUrl(slug: string, filename: string): string {
  return getWordMediaUrl(slug, filename);
}

/** Get the URL for a shared reusable asset (stored at words/assets/{assetId}/{filename}) */
function getSharedAssetUrl(assetId: string, filename: string): string {
  return getImageUrl(`words/assets/${assetId}/${filename}`);
}

/**
 * Resolve an image src from markdown.
 * - Absolute URLs (http/https) pass through unchanged.
 * - Relative paths (e.g. "words/media/slug/image.webp") get prepended with the R2 public URL.
 */
function resolveImageSrc(src: string): string {
  const trimmed = src.trim();
  if (!trimmed || trimmed.includes("\0")) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("data:")
  ) {
    return "";
  }
  if (trimmed.includes("..")) return "";
  return getImageUrl(trimmed.replace(/^\/+/, ""));
}

/**
 * Resolve markdown refs for words content.
 *
 * Supports:
 * - Canonical refs: words/media/... and words/assets/...
 * - Asset shorthand: assets/<assetId>/<file>
 * - Slug-local shorthand (when wordSlug is provided):
 *   - /hero.webp
 *   - hero.webp
 */
function resolveWordContentRef(ref: string, wordSlug?: string): string {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.includes("\0")) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("#") || trimmed.startsWith("?")) return trimmed;

  const lower = trimmed.toLowerCase();
  if (DISALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return "";
  }
  if (trimmed.includes("..")) return "";

  const normalized = trimmed.replace(/^\/+/, "");
  const normalizedLower = normalized.toLowerCase();

  if (normalizedLower.startsWith("words/media/") || normalizedLower.startsWith("words/assets/")) {
    return getImageUrl(normalized);
  }

  if (normalizedLower.startsWith("assets/")) {
    return getImageUrl(`words/assets/${normalized.slice("assets/".length)}`);
  }

  if (trimmed.startsWith("/") && INTERNAL_ROUTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return trimmed;
  }

  if (wordSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wordSlug)) {
    return getImageUrl(`words/media/${wordSlug}/${normalized}`);
  }

  return getImageUrl(normalized);
}

/* ─── Transfer URLs ─── */

/** Get the thumbnail URL for a transfer image (WebP, images and GIF first-frame only) */
function getTransferThumbUrl(transferId: string, fileId: string): string {
  return getImageUrl(`transfers/${transferId}/thumb/${fileId}.webp`);
}

/** Get the full-size viewing URL for a transfer image (WebP, processed images only) */
function getTransferFullUrl(transferId: string, fileId: string): string {
  return getImageUrl(`transfers/${transferId}/full/${fileId}.webp`);
}

/** Get the original file URL for any transfer file (preserves real filename) */
function getTransferFileUrl(transferId: string, filename: string): string {
  return getImageUrl(`transfers/${transferId}/original/${filename}`);
}

export {
  getImageUrl,
  getThumbUrl,
  getFullUrl,
  getOriginalUrl,
  getOgUrl,
  getWordMediaUrl,
  getBlogImageUrl,
  getSharedAssetUrl,
  resolveImageSrc,
  resolveWordContentRef,
  getTransferThumbUrl,
  getTransferFullUrl,
  getTransferFileUrl,
};
