import { queryOptions } from "@tanstack/react-query";
import { getAdminSiteSettingsFn } from "./site-settings.functions";

export const adminSiteSettingsQuery = queryOptions({
  queryKey: ["admin", "site", "footer-party"] as const,
  queryFn: async () => {
    const result = await getAdminSiteSettingsFn();
    if (!result.authorised) throw new Error("Your admin session has expired");
    return result.settings;
  },
  staleTime: 10_000,
  retry: false,
});
