import { queryOptions } from "@tanstack/react-query";
import { getAlbumsPageFn } from "./albums.functions";

export const albumsPageQuery = queryOptions({
  queryKey: ["albums", "public", "index"] as const,
  queryFn: () => getAlbumsPageFn(),
  staleTime: 15_000,
});
