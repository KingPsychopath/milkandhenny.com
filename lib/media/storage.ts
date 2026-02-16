/**
 * S3-compatible storage abstraction.
 * Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, etc.
 * To switch providers, change the env vars — zero code changes.
 */

import { R2_PUBLIC_URL } from "../config";

/** Build the public URL for a file in the bucket */
function getImageUrl(path: string): string {
  return `${R2_PUBLIC_URL}/${path}`;
}

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

/* ─── Blog image URLs ─── */

/** Get the URL for a blog image (WebP, stored at blog/{slug}/{filename}) */
function getBlogImageUrl(slug: string, filename: string): string {
  return getImageUrl(`blog/${slug}/${filename}`);
}

/**
 * Resolve an image src from markdown.
 * - Absolute URLs (http/https) pass through unchanged.
 * - Relative paths (e.g. "blog/slug/image.webp") get prepended with the R2 public URL.
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
  getBlogImageUrl,
  resolveImageSrc,
  getTransferThumbUrl,
  getTransferFullUrl,
  getTransferFileUrl,
};
