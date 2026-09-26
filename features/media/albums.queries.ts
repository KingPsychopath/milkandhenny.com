import { queryOptions } from "@tanstack/react-query";
import { getAlbumPageFn, getAlbumsPageFn } from "./albums.functions";

export const albumsPageQuery = queryOptions({
  queryKey: ["albums", "public", "index"] as const,
  queryFn: () => getAlbumsPageFn(),
  staleTime: 15_000,
});

export const albumPageQuery = (album: string) =>
  queryOptions({
    queryKey: ["albums", "public", "detail", album] as const,
    queryFn: () => getAlbumPageFn({ data: { album } }),
    staleTime: 15_000,
  });
