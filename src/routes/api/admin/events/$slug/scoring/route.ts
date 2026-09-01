import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { recordBody, stringValue } from "@/features/event-scoring/admin-api/shared";
import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, eventSlug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    return await runEventsEffect(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.readAdmin(request, eventSlug, auth.actorId ?? "root-owner");
      }),
      request.signal,
    );
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
    return await runEventsEffect(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.runAdminAction(stringValue(body.action), {
          request,
          eventSlug,
          actorId: auth.actorId ?? "root-owner",
          body,
        });
      }),
      request.signal,
    );
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
