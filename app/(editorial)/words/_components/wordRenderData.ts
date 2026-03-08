import "server-only";

import { extractHeadings } from "@/features/words/headings";
import { resolveAlbumsFromWordContent } from "./wordPageShared";

type WordRenderData = {
  headings: ReturnType<typeof extractHeadings>;
  albums: ReturnType<typeof resolveAlbumsFromWordContent>;
};

const cache = new Map<string, WordRenderData>();

function getWordRenderData(slug: string, updatedAt: string, markdown: string): WordRenderData {
  const key = `${slug}:${updatedAt}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const value = {
    headings: extractHeadings(markdown),
    albums: resolveAlbumsFromWordContent(markdown),
  };
  cache.set(key, value);
  return value;
}

export { getWordRenderData };
