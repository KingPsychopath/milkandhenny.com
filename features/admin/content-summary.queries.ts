import { queryOptions } from "@tanstack/react-query";
import { getAdminContentSummaryFn } from "./content-summary.functions";

/** Private admin view; identity transitions clear this entry. */
export const adminContentSummaryQuery = queryOptions({
  queryKey: ["admin", "content-summary"] as const,
  queryFn: () => getAdminContentSummaryFn(),
  staleTime: 15_000,
});
