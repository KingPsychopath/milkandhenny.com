import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess, requireAuthWithPayload } from "@/features/auth/auth.server";
import { loadAdminInbox } from "./admin-inbox.server";

export const getAdminOperationsInboxFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const [access, auth] = await Promise.all([
    getAdminWorkspaceAccess(request),
    requireAuthWithPayload(request, "admin"),
  ]);
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  if (!access.permissions.viewOperations)
    return { ok: false as const, status: 403, error: "Operations access required" };
  if (auth.error) return { ok: false as const, status: auth.error.status, error: "Unauthorized" };
  const viewer = {
    actorId: auth.actorId ?? "root-owner",
    actorType: auth.actorType === "admin" ? ("admin" as const) : ("root-owner" as const),
  };
  return {
    ok: true as const,
    data: await loadAdminInbox(viewer, { active: true }, request.signal),
  };
});
