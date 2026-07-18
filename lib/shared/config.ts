/**
 * Site-wide constants — single source of truth for identity, URLs, and public config.
 * Keeps hardcoded strings out of page files and metadata objects.
 */

/** Title-case name for metadata, OG siteName, copyright on party pages */
const SITE_NAME = "Milk & Henny";

/** Lowercase brand for editorial UI, nav headers, OG alt text, RSS title */
const SITE_BRAND = "milk & henny";

const viteEnv = import.meta.env as Record<string, string | undefined> | undefined;
const runtimeEnv = typeof process === "undefined" ? undefined : process.env;

/** Canonical base URL (sitemap, RSS, OG, share links). Strips inline env comments. */
const BASE_URL = (viteEnv?.VITE_BASE_URL || runtimeEnv?.VITE_BASE_URL || "https://milkandhenny.com")
  .trim()
  .split(/\s+#/)[0]
  .trim();

/** Public media/CDN origin. */
const MEDIA_PUBLIC_URL =
  viteEnv?.VITE_MEDIA_PUBLIC_URL ??
  runtimeEnv?.VITE_MEDIA_PUBLIC_URL ??
  "";

/** Base URL for share links — uses request origin when available (e.g. localhost in dev), else BASE_URL */
function getBaseUrlForRequest(request: { url: string }): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return BASE_URL;
  }
}

function hasMediaPublicUrl(): boolean {
  return MEDIA_PUBLIC_URL.trim().length > 0;
}

export {
  SITE_NAME,
  SITE_BRAND,
  BASE_URL,
  MEDIA_PUBLIC_URL,
  hasMediaPublicUrl,
  getBaseUrlForRequest,
};
