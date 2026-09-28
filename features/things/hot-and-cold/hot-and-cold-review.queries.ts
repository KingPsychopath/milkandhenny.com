import { queryOptions } from "@tanstack/react-query";
import { getAdminHotAndColdReviewFn } from "./hot-and-cold-review.functions";

/** Review evidence is only requested when its admin disclosure opens. */
export const adminHotAndColdReviewQuery = queryOptions({
  queryKey: ["admin", "games", "hot-and-cold", "quality-review"] as const,
  queryFn: () => getAdminHotAndColdReviewFn(),
  staleTime: 60_000,
  retry: false,
});
