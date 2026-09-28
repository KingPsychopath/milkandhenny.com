import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import {
  getAdminPitchDetail,
  getAdminPitchReminders,
  getAdminPitchWorkspace,
} from "./admin-workspace.server";
import { isPitchDeckId } from "./validation";

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

export const getAdminPitchDetailFn = createServerFn({ method: "GET" })
  .validator((data: { deckId: string }) => ({ deckId: data.deckId.slice(0, 128) }))
  .handler(async ({ data }) => {
    const signal = await requirePitchAdmin();
    if (!isPitchDeckId(data.deckId)) throw new Error("Pitch not found");
    const result = await getAdminPitchDetail(data.deckId, signal);
    if (!result.ok) throw new Error(result.error);
    if (!result.value) throw new Error("Pitch not found");
    // The manager renders audit action/actor/time; arbitrary metadata is not a browser contract.
    return {
      ...result.value,
      audit: result.value.audit.map((event) => ({ ...event, metadata: {} })),
    };
  });
