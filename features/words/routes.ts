import type { WordVisibility } from "./content-types";

const WORDS_PUBLIC_PREFIX = "/words";
const WORDS_PRIVATE_PREFIX = "/vault";

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function wordPublicPath(slug: string): string {
  return `${WORDS_PUBLIC_PREFIX}/${slug}`;
}

function wordPrivatePath(slug: string): string {
  return `${WORDS_PRIVATE_PREFIX}/${slug}`;
}

function wordPathForVisibility(slug: string, visibility: WordVisibility): string {
  return visibility === "private" ? wordPrivatePath(slug) : wordPublicPath(slug);
}

function buildWordShareUrl(
  baseUrl: string,
  slug: string,
  token: string,
  visibility: WordVisibility
): string {
  const origin = trimTrailingSlash(baseUrl);
  const path = wordPathForVisibility(slug, visibility);
  return `${origin}${path}?share=${encodeURIComponent(token)}`;
}

export {
  WORDS_PUBLIC_PREFIX,
  WORDS_PRIVATE_PREFIX,
  wordPublicPath,
  wordPrivatePath,
  wordPathForVisibility,
  buildWordShareUrl,
};
