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
const MEDIA_PUBLIC_URL = viteEnv?.VITE_MEDIA_PUBLIC_URL ?? runtimeEnv?.VITE_MEDIA_PUBLIC_URL ?? "";

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Base URL for share links.
 *
 * Development answers on whatever host the browser asked for, so the request
 * origin is the only correct answer there. Everywhere else it is the wrong
 * one: TLS terminates at the proxy and Nitro sees a plain `http://` URL, which
 * would otherwise put `http://` links into ticket emails, calendar files and
 * Stripe return URLs. `BASE_URL` is the canonical origin for each deployment
 * (supplied as a build argument), so it is what those links must use.
 */
function getBaseUrlForRequest(request: { url: string }): string {
  try {
    const url = new URL(request.url);
    return isLoopbackHost(url.hostname) ? url.origin : BASE_URL;
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
