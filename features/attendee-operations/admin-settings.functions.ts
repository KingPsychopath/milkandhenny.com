import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listNamedAdminGrants } from "./access-grants.server";
import { getAdminOperationsSettings } from "./admin-settings.server";

export const getAdminOperationsSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageGlobalSettings)
    throw new Error("Access policy management required");
  return getAdminOperationsSettings();
});

export const getNamedAdminGrantsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageGlobalSettings)
    throw new Error("Administrator access management required");
  return listNamedAdminGrants();
});
