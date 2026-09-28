import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "./auth.server";
import { listTokenSessions, TokenSessionsUnavailableError } from "./token-sessions.server";

export const getAdminTokenSessionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  if (!access.permissions.manageGlobalSettings)
    return { ok: false as const, status: 403, error: "Session security access required" };
  try {
    return { ok: true as const, data: await listTokenSessions() };
  } catch (error) {
    if (error instanceof TokenSessionsUnavailableError)
      return { ok: false as const, status: 503, error: error.message };
    throw error;
  }
});
