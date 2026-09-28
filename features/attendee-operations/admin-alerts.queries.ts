import { queryOptions } from "@tanstack/react-query";
import { getAdminAlertSettingsFn } from "./admin-alerts.functions";

export const adminAlertSettingsQuery = queryOptions({
  queryKey: ["admin", "operations", "alerts"] as const,
  queryFn: () => getAdminAlertSettingsFn(),
  staleTime: 10_000,
  retry: false,
});
