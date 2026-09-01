import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { listGuestRequests } from "@/features/tickets/guest-requests.server";
import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";

/**
 * Admin view of scanners' guest requests: list them, approve, decline.
 * Approval comps a ticket immediately.
 */

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const requests = await listGuestRequests(slug);
    return Response.json({ requests });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.guest-requests",
      "Failed to load guest requests",
      error,
    );
  }
}

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const id = typeof record.id === "number" ? record.id : Number.NaN;
    const action =
      record.action === "approve" || record.action === "decline" ? record.action : null;
    if (!Number.isInteger(id) || !action) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const result = await runEventsEffect(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.decideAdminGuest({
          eventSlug: slug,
          id,
          approve: action === "approve",
          decidedBy: "admin",
          ticketTypeId: typeof record.ticketTypeId === "string" ? record.ticketTypeId : undefined,
        });
      }),
      request.signal,
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ request: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.guest-requests",
      "Failed to decide the request",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/guest-requests")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
