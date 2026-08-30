const VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";
const MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const PRIVATE_MEDIA_CACHE_CONTROL = "private, no-store";
const STATIC_IMAGE_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const DYNAMIC_DOCUMENT_CACHE_CONTROL = "no-cache";
const PUBLIC_DISCOVERY_CACHE_CONTROL =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600, stale-if-error=86400";
const STATIC_ROOT_IMAGE_PATHS = [
  "/MAHLogo.svg",
  "/MAHtext.svg",
  "/apple-icon.png",
  "/email-logo.png",
  "/favicon.ico",
  "/favicon-mono-mh.svg",
  "/file.svg",
  "/globe.svg",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
] as const;

export {
  DYNAMIC_DOCUMENT_CACHE_CONTROL,
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  PUBLIC_DISCOVERY_CACHE_CONTROL,
  STATIC_IMAGE_CACHE_CONTROL,
  STATIC_ROOT_IMAGE_PATHS,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
};
