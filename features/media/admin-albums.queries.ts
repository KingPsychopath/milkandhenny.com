import { queryOptions } from "@tanstack/react-query";
import { getAdminAlbumsFn } from "./admin-albums.functions";

export const adminAlbumsQuery = queryOptions({
  queryKey: ["admin", "albums", "all"] as const,
  queryFn: () => getAdminAlbumsFn(),
  staleTime: 10_000,
  retry: false,
});
