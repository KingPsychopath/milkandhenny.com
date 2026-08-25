import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { runAdminScoringAction } from "@/features/event-scoring/admin-api/actions.server";
import { readAdminScoring } from "@/features/event-scoring/admin-api/read.server";
import { recordBody, stringValue } from "@/features/event-scoring/admin-api/shared";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, eventSlug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    return await readAdminScoring(request, eventSlug, auth.payload?.jti ?? "admin-local");
  } catch (error) {
    return apiErrorFromRequest(request, "event-scoring.admin.get", "Could not load scoring", error);
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
    return await runAdminScoringAction(stringValue(body.action), {
      request,
      eventSlug,
      actorId: auth.payload?.jti ?? "admin-local",
      body,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "event-scoring.admin.post", "Scoring action failed", error);
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/scoring")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
