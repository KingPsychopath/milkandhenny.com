import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import {
  cleanupOrphanWordMediaFolders,
  scanOrphanWordMediaFolders,
} from "@/features/words/media-maintenance";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const limitRaw = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  try {
    const summary = await scanOrphanWordMediaFolders({ limit });
    return Response.json(summary);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-media.orphans.scan",
      "Failed to scan orphan word media folders",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const result = await cleanupOrphanWordMediaFolders();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-media.orphans.cleanup",
      "Failed to cleanup orphan word media folders",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/word-media/orphans")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
