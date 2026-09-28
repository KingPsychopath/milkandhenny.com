import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getAdminSystemHealth } from "./admin-health.server";

export const getAdminSystemHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  if (!access.permissions.viewOperations)
    return { ok: false as const, status: 403, error: "Operations access required" };
  return { ok: true as const, data: await getAdminSystemHealth() };
});
