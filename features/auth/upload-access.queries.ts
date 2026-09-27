import { queryOptions } from "@tanstack/react-query";
import { getAdminUploadAccessStatusFn } from "./upload-access.functions";

export const adminUploadAccessQuery = queryOptions({
  queryKey: ["admin", "transfers", "upload-access"] as const,
  queryFn: async () => {
    const result = await getAdminUploadAccessStatusFn();
    if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
    return result.data;
  },
  staleTime: 5_000,
  retry: false,
});
