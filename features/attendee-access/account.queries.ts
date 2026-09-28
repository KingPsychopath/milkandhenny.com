import { queryOptions } from "@tanstack/react-query";
import { getMyAccountFn } from "./access.functions";

/** Current viewer only. Identity transitions clear the entire browser query cache. */
export const myAccountQuery = queryOptions({
  queryKey: ["attendee", "current", "account"] as const,
  queryFn: () => getMyAccountFn(),
  staleTime: 5_000,
});
