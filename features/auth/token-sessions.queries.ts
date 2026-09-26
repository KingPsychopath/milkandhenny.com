import { queryOptions } from "@tanstack/react-query";
import { getAdminTokenSessionsFn } from "./token-sessions.functions";

export const adminTokenSessionsQuery = queryOptions({
  queryKey: ["admin", "security", "token-sessions"] as const,
  queryFn: async () => {
    const result = await getAdminTokenSessionsFn();
    if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
    return result.data;
  },
  staleTime: 10_000,
});
