import { queryOptions } from "@tanstack/react-query";
import { getAdminSonderEventFn } from "./admin.functions";
export const adminSonderEventQuery = (slug: string) =>
  queryOptions({
    queryKey: ["admin", "events", slug, "sonder"] as const,
    queryFn: () => getAdminSonderEventFn({ data: { slug } }),
    staleTime: 5_000,
    retry: false,
  });
