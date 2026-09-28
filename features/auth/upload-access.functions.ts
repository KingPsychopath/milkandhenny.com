import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "./auth.server";
import { getUploadAccessStatus } from "./upload-access.server";

export const getAdminUploadAccessStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  if (!access.permissions.manageContent)
    return { ok: false as const, status: 403, error: "Transfer management access required" };
  return { ok: true as const, data: await getUploadAccessStatus() };
});
