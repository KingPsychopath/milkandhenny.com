import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getAdminAlertSettings } from "./admin-alerts.server";

export const getAdminAlertSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageCommunications)
    throw new Error("Communications access required");
  return getAdminAlertSettings();
});
