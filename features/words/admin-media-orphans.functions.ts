import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";

export const getAdminWordMediaOrphansFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const access = await getAdminWorkspaceAccess(request);
  if (!access.ok || !access.permissions.manageContent)
    throw new Error("Content management access required");
  try {
    return await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* MediaMaintenanceService).scanWordMedia({ limit: 100 });
      }),
      request.signal,
    );
  } catch {
    throw new Error("Failed to scan orphan word media folders");
  }
});
