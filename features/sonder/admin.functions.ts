import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader, getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { readSonderEvent } from "./sonder.server";
export const getAdminSonderEventFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => ({ slug: data.slug.trim().slice(0, 80) }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.viewOperations)
      throw new Error("Event operations access required");
    return readSonderEvent(data.slug);
  });
