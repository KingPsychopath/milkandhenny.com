import { queryOptions } from "@tanstack/react-query";
import { getWordsPageFn } from "./reader.functions";

export const wordsPageQuery = queryOptions({
  queryKey: ["words", "public", "index"] as const,
  queryFn: () => getWordsPageFn(),
  staleTime: 15_000,
});
