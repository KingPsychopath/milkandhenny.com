import { queryOptions } from "@tanstack/react-query";
import { getAdminTransferFn, getAdminTransfersFn } from "./admin.functions";

/** Private admin views; identity transitions clear these entries. */
export const adminTransfersQuery = queryOptions({
  queryKey: ["admin", "transfers", "list"] as const,
  queryFn: () => getAdminTransfersFn(),
  staleTime: 10_000,
  retry: false,
});

export function adminTransferDetailQuery(id: string) {
  return queryOptions({
    queryKey: ["admin", "transfers", "detail", id] as const,
    queryFn: () => getAdminTransferFn({ data: { id } }),
    staleTime: 10_000,
    retry: false,
  });
}
