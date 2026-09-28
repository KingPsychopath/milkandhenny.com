import { queryOptions } from "@tanstack/react-query";
import { getAdminSharedWordsFn } from "./admin-shares.functions";

export const adminSharedWordsQuery = queryOptions({
  queryKey: ["admin", "content", "shared-words"] as const,
  queryFn: () => getAdminSharedWordsFn(),
  staleTime: 10_000,
  retry: false,
});
