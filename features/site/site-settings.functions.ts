import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getFooterPartySettings, setFooterPartyPath } from "./site-settings.server";

export const getAdminSiteSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAdminWorkspaceAccess(getRequest());
  if (!auth.ok || !auth.permissions.manageGlobalSettings) return { authorised: false as const };
  return { authorised: true as const, settings: await getFooterPartySettings() };
});

export const updateAdminSiteSettingsFn = createServerFn({ method: "POST" })
  .validator((data: { footerPartyPath: string | null }) => data)
  .handler(async ({ data }) => {
    const auth = await getAdminWorkspaceAccess(getRequest());
    if (!auth.ok || !auth.permissions.manageGlobalSettings) return { authorised: false as const };
    const result = await setFooterPartyPath(data.footerPartyPath);
    return result.ok
      ? { authorised: true as const, ...result }
      : { authorised: true as const, ...result };
  });
