import { queryOptions } from "@tanstack/react-query";
import { getAdminCreditGrantsFn, getAdminCreditsFn } from "./credits.functions";

/** Private admin views; identity transitions clear these entries. */
export const adminCreditsQuery = queryOptions({
  queryKey: ["admin", "credits", "campaigns"] as const,
  queryFn: () => getAdminCreditsFn(),
  staleTime: 10_000,
  retry: false,
});

export function adminCreditGrantsQuery(campaignId: string) {
  return queryOptions({
    queryKey: ["admin", "credits", "grants", campaignId] as const,
    queryFn: () => getAdminCreditGrantsFn({ data: { campaignId } }),
    staleTime: 10_000,
    retry: false,
  });
}
