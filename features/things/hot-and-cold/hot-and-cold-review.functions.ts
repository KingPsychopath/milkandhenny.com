import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getHotAndColdQualityReport } from "./hot-and-cold-review.server";

export const getAdminHotAndColdReviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageScoring)
    throw new Error("Game operations access required");
  return getHotAndColdQualityReport();
});
