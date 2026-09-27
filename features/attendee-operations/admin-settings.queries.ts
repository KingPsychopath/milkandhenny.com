import { queryOptions } from "@tanstack/react-query";
import { getAdminOperationsSettingsFn, getNamedAdminGrantsFn } from "./admin-settings.functions";

export const adminOperationsSettingsQuery = queryOptions({
  queryKey: ["admin", "operations", "settings"] as const,
  queryFn: () => getAdminOperationsSettingsFn(),
  staleTime: 10_000,
  retry: false,
});

export const namedAdminGrantsQuery = queryOptions({
  queryKey: ["admin", "operations", "named-admin-grants"] as const,
  queryFn: () => getNamedAdminGrantsFn(),
  staleTime: 10_000,
  retry: false,
});
