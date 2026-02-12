/**
 * S3-compatible storage abstraction.
 * Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, etc.
 * To switch providers, change the env vars — zero code changes.
 *
 * NOTE: These functions use NEXT_PUBLIC_ env vars so they work
 * in both server and client contexts.
 */

/** Build the public URL for an image in the bucket */
function getImageUrl(path: string): string {
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  return `${publicUrl}/${path}`;
}

/** Get the thumbnail URL for a photo */
function getThumbUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/thumb/${photoId}.jpg`);
}

/** Get the full-size viewing URL for a photo */
function getFullUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/full/${photoId}.jpg`);
}

/** Get the original (download) URL for a photo */
function getOriginalUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/original/${photoId}.jpg`);
}

export { getImageUrl, getThumbUrl, getFullUrl, getOriginalUrl };
