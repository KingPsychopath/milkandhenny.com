import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getAdminPitchReminders, getAdminPitchWorkspace } from "./admin-workspace.server";

async function requirePitchAdmin() {
  const request = getRequest();
  const access = await getAdminWorkspaceAccess(request);
  if (!access.ok || !access.permissions.manageContent)
    throw new Error("Pitch management access required");
  return request.signal;
}

export const getAdminPitchWorkspaceFn = createServerFn({ method: "GET" }).handler(async () => {
  const result = await getAdminPitchWorkspace(await requirePitchAdmin());
  if (!result.ok) throw new Error(result.error);
  return { pitches: result.pitches, operationalStatus: result.operationalStatus };
});

export const getAdminPitchRemindersFn = createServerFn({ method: "GET" }).handler(async () => {
  const result = await getAdminPitchReminders(await requirePitchAdmin());
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
