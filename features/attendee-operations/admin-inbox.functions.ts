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

type InboxCaseFilters = {
  status: string;
  severity: string;
  category: string;
  eventSlug: string;
};

export const getAdminCaseInboxFn = createServerFn({ method: "GET" })
  .validator((data: InboxCaseFilters) => ({
    status: data.status,
    severity: data.severity,
    category: data.category.trim().slice(0, 100),
    eventSlug: data.eventSlug.trim().slice(0, 160),
  }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const [access, auth] = await Promise.all([
      getAdminWorkspaceAccess(request),
      requireAuthWithPayload(request, "admin"),
    ]);
    if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
    if (!access.permissions.viewOperations)
      return { ok: false as const, status: 403, error: "Operations access required" };
    if (auth.error) return { ok: false as const, status: auth.error.status, error: "Unauthorized" };
    return {
      ok: true as const,
      data: await loadAdminInbox(
        {
          actorId: auth.actorId ?? "root-owner",
          actorType: auth.actorType === "admin" ? "admin" : "root-owner",
        },
        {
          status: ["new", "in-progress", "resolved", "dismissed"].includes(data.status)
            ? (data.status as "new" | "in-progress" | "resolved" | "dismissed")
            : undefined,
          severity: ["info", "prompt", "warning", "critical"].includes(data.severity)
            ? (data.severity as "info" | "prompt" | "warning" | "critical")
            : undefined,
          category: data.category || undefined,
          eventSlug: data.eventSlug || undefined,
        },
        request.signal,
      ),
    };
  });
