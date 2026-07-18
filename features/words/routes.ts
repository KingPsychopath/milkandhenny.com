import type { WordVisibility } from "./content-types";
import { buildAppUrl } from "@/lib/shared/app-url";

const WORDS_PUBLIC_PREFIX = "/words";
const WORDS_PRIVATE_PREFIX = "/vault";

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
  visibility: WordVisibility,
): string {
  const path = wordPathForVisibility(slug, visibility);
  return buildAppUrl(baseUrl, path, { search: { share: token } });
}

export {
  WORDS_PUBLIC_PREFIX,
  WORDS_PRIVATE_PREFIX,
  wordPublicPath,
  wordPrivatePath,
  wordPathForVisibility,
  buildWordShareUrl,
};
