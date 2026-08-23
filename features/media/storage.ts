/**
 * S3-compatible storage abstraction.
 * Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, etc.
 * To switch providers, change the env vars — zero code changes.
 */

import { MEDIA_PUBLIC_URL } from "@/lib/shared/config";
import type { Photo } from "./albums";
import type { ResponsiveImageData, ResponsiveImageFormat, ResponsiveImageSource } from "./image";

/** Build the public URL for a file in the bucket */
function getImageUrl(path: string): string {
  return `${MEDIA_PUBLIC_URL}/${path}`;
}

function encodeStoragePathSegment(value: string): string {
  return encodeURIComponent(value);
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
const TYPED_SLUG_MEDIA_REF = /^(blog|note|recipe|review)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/i;

/* ─── Album URLs ─── */

function versionedUrl(url: string, version: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function getAlbumImageUrl(
  album: string,
  photoId: string,
  width: number,
  format: ResponsiveImageFormat,
  version: string,
): string {
  return versionedUrl(
    getImageUrl(
      `albums/${encodeStoragePathSegment(album)}/images/${encodeStoragePathSegment(photoId)}/${width}.${format}`,
    ),
    version,
  );
}

function getAlbumImageData(album: string, photo: Photo): ResponsiveImageData {
  const srcSetFor = (format: ResponsiveImageFormat) =>
    photo.widths
      .map(
        (width) => `${getAlbumImageUrl(album, photo.id, width, format, photo.version)} ${width}w`,
      )
      .join(", ");
  const largestWidth = photo.widths.at(-1) ?? photo.width;
  const sources: ResponsiveImageSource[] = [{ type: "image/avif", srcSet: srcSetFor("avif") }];

  return {
    ...photo,
    src: getAlbumImageUrl(album, photo.id, largestWidth, "webp", photo.version),
    srcSet: srcSetFor("webp"),
    sources,
  };
}

/** Get the original (download) URL for an album photo */
function getOriginalUrl(album: string, photoId: string): string {
  return getImageUrl(`albums/${album}/original/${photoId}.jpg`);
}

function getOriginalStorageKey(album: string, photoId: string): string {
  return `albums/${album}/original/${photoId}.jpg`;
}

/** Get the OG-sized JPEG URL for Open Graph / social sharing */
function getOgUrl(album: string, photoId: string, version?: string): string {
  const url = getImageUrl(`albums/${album}/og/${photoId}.jpg`);
  return version ? versionedUrl(url, version) : url;
}

/* ─── Word media URLs ─── */

/** Get the URL for per-word media (stored at words/media/{slug}/{filename}) */
function getWordMediaUrl(slug: string, filename: string): string {
  return getImageUrl(
    `words/media/${encodeStoragePathSegment(slug)}/${encodeStoragePathSegment(filename)}`,
  );
}

/** Get the URL for a shared reusable asset (stored at words/assets/{assetId}/{filename}) */
function getSharedAssetUrl(assetId: string, filename: string): string {
  return getImageUrl(
    `words/assets/${encodeStoragePathSegment(assetId)}/${encodeStoragePathSegment(filename)}`,
  );
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
function resolveWordContentRef(
  ref: string,
  wordSlug?: string,
  options?: { privacy?: "public" | "private" },
): string {
  const extractedRef = ref.trim();
  if (!extractedRef || extractedRef.includes("\0")) return "";
  const markdownRefMatch = extractedRef.match(/^!?\[[^\]]*]\((\S+)(?:\s+["'][^"']*["'])?\)$/);
  const trimmed = markdownRefMatch ? markdownRefMatch[1].trim() : extractedRef;
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

  if (options?.privacy === "private") {
    const privateMediaPrefix = wordSlug ? `words/media/${wordSlug}/` : "";
    if (privateMediaPrefix && normalizedLower.startsWith(privateMediaPrefix.toLowerCase())) {
      const filename = normalized.slice(privateMediaPrefix.length);
      if (/^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(filename)) {
        return `/api/words/${encodeStoragePathSegment(wordSlug ?? "")}/media/${encodeStoragePathSegment(filename)}`;
      }
      return "";
    }
    if (normalizedLower.startsWith("words/assets/") || normalizedLower.startsWith("assets/")) {
      return "";
    }
  }

  if (normalizedLower.startsWith("words/media/") || normalizedLower.startsWith("words/assets/")) {
    return getImageUrl(normalized);
  }

  if (normalizedLower.startsWith("assets/")) {
    return getImageUrl(`words/assets/${normalized.slice("assets/".length)}`);
  }

  const typedMatch = normalized.match(TYPED_SLUG_MEDIA_REF);
  if (typedMatch) {
    const [, , slug, rest] = typedMatch;
    if (!wordSlug || slug === wordSlug) {
      return getImageUrl(`words/media/${slug}/${rest}`);
    }
  }

  if (
    trimmed.startsWith("/") &&
    INTERNAL_ROUTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    // Default web semantics: a leading slash is a site-root path.
    return trimmed;
  }

  if (wordSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wordSlug)) {
    if (options?.privacy === "private") {
      if (!/^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(normalized)) return "";
      return `/api/words/${encodeStoragePathSegment(wordSlug)}/media/${encodeStoragePathSegment(normalized)}`;
    }
    return getImageUrl(`words/media/${wordSlug}/${normalized}`);
  }

  return getImageUrl(normalized);
}

/* ─── Transfer URLs ─── */

function getTransferMediaUrl(
  transferId: string,
  fileId: string,
  variant: "primary" | "original" | "thumb" | "full",
  download = false,
): string {
  const path = `/api/transfers/${encodeStoragePathSegment(transferId)}/media/${encodeStoragePathSegment(fileId)}/${variant}`;
  return download ? `${path}?download=1` : path;
}

/** Get the protected thumbnail URL for a transfer image. */
function getTransferThumbUrl(transferId: string, fileId: string): string {
  return getTransferMediaUrl(transferId, fileId, "thumb");
}

/** Get the protected full-size preview URL for a transfer image. */
function getTransferFullUrl(transferId: string, fileId: string): string {
  return getTransferMediaUrl(transferId, fileId, "full");
}

function getTransferPrimaryUrl(transferId: string, fileId: string): string {
  return getTransferMediaUrl(transferId, fileId, "primary");
}

function getTransferOriginalUrl(transferId: string, fileId: string, download = false): string {
  return getTransferMediaUrl(transferId, fileId, "original", download);
}

function getTransferImageSrcSet(transferId: string, fileId: string, sourceWidth: number): string {
  const thumbWidth = Math.min(600, sourceWidth);
  const fullWidth = Math.min(1600, sourceWidth);
  if (thumbWidth === fullWidth) {
    return `${getTransferFullUrl(transferId, fileId)} ${fullWidth}w`;
  }
  return `${getTransferThumbUrl(transferId, fileId)} ${thumbWidth}w, ${getTransferFullUrl(transferId, fileId)} ${fullWidth}w`;
}

export {
  getImageUrl,
  getAlbumImageData,
  getAlbumImageUrl,
  getOriginalUrl,
  getOriginalStorageKey,
  getOgUrl,
  getWordMediaUrl,
  getSharedAssetUrl,
  resolveImageSrc,
  resolveWordContentRef,
  getTransferThumbUrl,
  getTransferFullUrl,
  getTransferPrimaryUrl,
  getTransferOriginalUrl,
  getTransferImageSrcSet,
};
