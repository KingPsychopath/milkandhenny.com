import { queryOptions } from "@tanstack/react-query";
import { getAdminReportsFn } from "./admin-reports.functions";

export const adminReportsQuery = (includeResolved: boolean) =>
  queryOptions({
    queryKey: ["admin", "reports", includeResolved ? "history" : "open"] as const,
    queryFn: async () => {
      const result = await getAdminReportsFn({ data: { includeResolved } });
      if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
      return result.reports;
    },
    staleTime: 10_000,
    retry: false,
  });
