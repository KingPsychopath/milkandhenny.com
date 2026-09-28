import { queryOptions } from "@tanstack/react-query";
import { getTransferPageFn } from "./transfer.functions";

/** No owner token enters this cache. Sign-in and sign-out clear its viewer scope. */
export const transferPageQuery = (id: string) =>
  queryOptions({
    queryKey: ["transfers", "viewer", id] as const,
    queryFn: () => getTransferPageFn({ data: { id } }),
    staleTime: 5_000,
  });
