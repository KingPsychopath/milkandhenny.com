import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listAdminReportGroups } from "./report-store.server";

export const getAdminReportsFn = createServerFn({ method: "GET" })
  .validator((data: { includeResolved: boolean }) => ({
    includeResolved: data.includeResolved === true,
  }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
    if (!access.permissions.viewAudit)
      return { ok: false as const, status: 403, error: "Audit access required" };
    return {
      ok: true as const,
      reports: await listAdminReportGroups(Date.now(), { includeResolved: data.includeResolved }),
    };
  });
