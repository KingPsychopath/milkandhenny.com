import { queryOptions } from "@tanstack/react-query";
import { getAdminWordMediaOrphansFn } from "./admin-media-orphans.functions";

export const adminWordMediaOrphansQuery = queryOptions({
  queryKey: ["admin", "content", "word-media-orphans", 100] as const,
  queryFn: () => getAdminWordMediaOrphansFn(),
  staleTime: 15_000,
  retry: false,
});
