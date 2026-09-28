import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listGamePoolsForAdmin } from "./admin.server";

export const getAdminGamePoolsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageScoring)
    throw new Error("Game operations access required");
  return listGamePoolsForAdmin();
});
