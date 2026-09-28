import { queryOptions } from "@tanstack/react-query";
import { getAdminSystemHealthFn } from "./admin-health.functions";

export const adminSystemHealthQuery = queryOptions({
  queryKey: ["admin", "system-health"] as const,
  queryFn: async () => {
    const result = await getAdminSystemHealthFn();
    if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
    return result.data;
  },
  staleTime: 5_000,
});
