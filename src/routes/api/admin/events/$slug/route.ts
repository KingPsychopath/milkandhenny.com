import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { EventsService } from "@/features/events/events-service.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";

/**
 * A single admin event: read, update, delete.
 *
 * Deletion requires step-up because an event with tickets sold against it is
 * not a recoverable thing to remove by accident.
 */

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const result = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        const tickets = yield* TicketsService;
        const event = yield* events.read(slug);
        if (!event) return { event: null, tickets: null };
        const summary = yield* tickets.forEvent(slug);
        return { event, tickets: summary };
      }),
    );

    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    if (!result.value.event) return Response.json({ error: "Event not found" }, { status: 404 });
    return Response.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.read", "Failed to read event", error);
  }
}

async function handlePATCH(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const result = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        return yield* events.update(slug, body as Record<string, unknown>);
      }),
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    if (!result.value.ok) {
      return Response.json({ error: result.value.error }, { status: result.value.status });
    }
    return Response.json({ event: result.value.value });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.update", "Failed to update event", error);
  }
}

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const result = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        return yield* events.remove(slug);
      }),
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    if (!result.value.ok) {
      return Response.json({ error: result.value.error }, { status: result.value.status });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.delete", "Failed to delete event", error);
  }
}

export const Route = createFileRoute("/api/admin/events/$slug")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      PATCH: ({ request, params }) => handlePATCH(request, params.slug),
      DELETE: ({ request, params }) => handleDELETE(request, params.slug),
    },
  },
});
