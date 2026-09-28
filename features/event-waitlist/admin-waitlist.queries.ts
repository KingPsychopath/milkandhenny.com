import { queryOptions } from "@tanstack/react-query";
import { getAdminWaitlistFn } from "./admin-waitlist.functions";

export const adminWaitlistQuery = (eventSlug: string) =>
  queryOptions({
    queryKey: ["admin", "events", eventSlug, "waitlist"] as const,
    queryFn: () => getAdminWaitlistFn({ data: { eventSlug } }),
    staleTime: 5_000,
    retry: false,
  });
