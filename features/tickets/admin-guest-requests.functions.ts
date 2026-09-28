import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listGuestRequests } from "./guest-requests.server";

export const getAdminGuestRequestsFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string }) => ({ eventSlug: data.eventSlug.trim().slice(0, 160) }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.viewOperations)
      throw new Error("Event operations access required");
    return listGuestRequests(data.eventSlug);
  });
