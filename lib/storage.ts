/**
 * S3-compatible storage abstraction.
 * Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, etc.
 * To switch providers, change the env vars — zero code changes.
 *
 * NOTE: These functions use NEXT_PUBLIC_ env vars so they work
 * in both server and client contexts.
 */

/** Build the public URL for a file in the bucket */
function getImageUrl(path: string): string {
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  return `${publicUrl}/${path}`;
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
  getTransferThumbUrl,
  getTransferFullUrl,
  getTransferFileUrl,
};
