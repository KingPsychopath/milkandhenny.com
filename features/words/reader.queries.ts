import { queryOptions } from "@tanstack/react-query";
import { getWordPageFn, getWordsPageFn } from "./reader.functions";

export const wordsPageQuery = queryOptions({
  queryKey: ["words", "public", "index"] as const,
  queryFn: () => getWordsPageFn(),
  staleTime: 15_000,
});

export const publicWordDetailQuery = (slug: string) =>
  queryOptions({
    queryKey: ["words", "public", "detail", slug] as const,
    queryFn: () => getWordPageFn({ data: { slug } }),
    staleTime: 15_000,
  });
