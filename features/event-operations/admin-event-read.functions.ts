import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { readAdminEventOperations } from "./admin-event-read.server";

export const getAdminEventOperationsFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => ({ slug: data.slug.trim().slice(0, 160) }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const access = await getAdminWorkspaceAccess(request);
    if (!access.ok || !access.permissions.viewOperations)
      throw new Error("Event operations access required");
    const result = await readAdminEventOperations(data.slug, request.signal);
    if (!result.ok) throw new Error(result.error);
    if (!result.value.tickets) throw new Error("Event not found");
    return result.value.tickets;
  });
