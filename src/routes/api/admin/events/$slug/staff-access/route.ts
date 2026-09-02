import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  readEventStaffAccess,
  runEventStaffAccessAction,
} from "@/features/event-operations/staff-access-admin.server";
import { recordBody } from "@/features/event-scoring/admin-api/shared";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, eventSlug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    return Response.json(await readEventStaffAccess(eventSlug));
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-staff-access.get",
      "Could not load staff access",
      error,
    );
  }
}

async function handlePOST(request: Request, eventSlug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) return stepUpError;

  try {
    const body = recordBody(await request.json().catch(() => null));
    if (!body) return Response.json({ error: "Invalid request body" }, { status: 400 });
    return await runEventStaffAccessAction({
      request,
      eventSlug,
      actorId: auth.actorId ?? "root-owner",
      body,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-staff-access.post",
      "Staff access change failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/staff-access")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
