import { queryOptions } from "@tanstack/react-query";
import { getAdminOperationsInboxFn } from "./admin-inbox.functions";

export const adminOperationsInboxQuery = queryOptions({
  queryKey: ["admin", "operations", "inbox", "active"] as const,
  queryFn: async () => {
    const result = await getAdminOperationsInboxFn();
    if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
    return result.data;
  },
  staleTime: 5_000,
});
