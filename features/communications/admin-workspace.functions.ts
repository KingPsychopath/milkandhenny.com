import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import {
  readCommunicationsWorkspace,
  type CommunicationsWorkspaceInput,
} from "./admin-workspace.server";

export const readCommunicationsWorkspaceFn = createServerFn({ method: "GET" })
  .validator((input: CommunicationsWorkspaceInput) => ({
    tab: typeof input.tab === "string" ? input.tab.slice(0, 40) : undefined,
    eventSlug: typeof input.eventSlug === "string" ? input.eventSlug.slice(0, 160) : undefined,
  }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.manageCommunications)
      throw new Error("Communications access required");
    return readCommunicationsWorkspace(data);
  });
