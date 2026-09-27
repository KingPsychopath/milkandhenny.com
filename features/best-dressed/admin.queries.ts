import { queryOptions } from "@tanstack/react-query";
import { getAdminBestDressedFn } from "./admin.functions";

export const adminBestDressedQuery = queryOptions({
  queryKey: ["admin", "best-dressed", "dashboard"] as const,
  queryFn: () => getAdminBestDressedFn(),
  staleTime: 5_000,
  retry: false,
});
