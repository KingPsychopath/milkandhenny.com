import { queryOptions } from "@tanstack/react-query";
import { getAdminGamePoolsFn } from "./admin.functions";

/** Private game entrance list; includes operator details and clears on identity transitions. */
export const adminGamePoolsQuery = queryOptions({
  queryKey: ["admin", "games", "pools"] as const,
  queryFn: () => getAdminGamePoolsFn(),
  staleTime: 10_000,
  retry: false,
});
