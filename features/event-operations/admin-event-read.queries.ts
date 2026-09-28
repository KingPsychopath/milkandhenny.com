import { queryOptions } from "@tanstack/react-query";
import { getAdminEventOperationsFn } from "./admin-event-read.functions";

export const adminEventOperationsQuery = (slug: string) =>
  queryOptions({
    queryKey: ["admin", "events", slug, "operations"] as const,
    queryFn: () => getAdminEventOperationsFn({ data: { slug } }),
    staleTime: 5_000,
    retry: false,
  });
