import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { isWordsEnabled } from "./reader.server";
import { buildSharedWordSummaries } from "./admin-shares.server";

export const getAdminSharedWordsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageContent)
    throw new Error("Content management access required");
  return isWordsEnabled() ? buildSharedWordSummaries() : [];
});
