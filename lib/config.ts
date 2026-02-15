/**
 * Site-wide constants — single source of truth for identity, URLs, and public config.
 * Keeps hardcoded strings out of page files and metadata objects.
 */

/** Title-case name for metadata, OG siteName, copyright on party pages */
const SITE_NAME = "Milk & Henny";

/** Lowercase brand for editorial UI, nav headers, OG alt text, RSS title */
const SITE_BRAND = "milk & henny";

/** Canonical base URL (sitemap, RSS, OG, share links). Strips inline env comments. */
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://milkandhenny.com")
  .trim()
  .split(/\s+#/)[0]
  .trim();

/** Public R2 / CDN origin for images and transfer files */
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

export { SITE_NAME, SITE_BRAND, BASE_URL, R2_PUBLIC_URL };
