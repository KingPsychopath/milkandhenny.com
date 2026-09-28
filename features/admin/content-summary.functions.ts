import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getAdminContentSummary } from "./content-summary.server";

export const getAdminContentSummaryFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageContent) throw new Error("Content access required");
  return getAdminContentSummary();
});
