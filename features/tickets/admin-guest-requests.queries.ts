import { queryOptions } from "@tanstack/react-query";
import { getAdminGuestRequestsFn } from "./admin-guest-requests.functions";

export const adminGuestRequestsQuery = (eventSlug: string) =>
  queryOptions({
    queryKey: ["admin", "events", eventSlug, "guest-requests"] as const,
    queryFn: () => getAdminGuestRequestsFn({ data: { eventSlug } }),
    staleTime: 5_000,
    retry: false,
  });
