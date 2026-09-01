import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { EventsService } from "@/features/events/events-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";

/**
 * Admin event collection: list and create.
 *
 * Routes own transport and coarse authorization only; validation and product
 * rules live in the events engine.
 */

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const result = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        return yield* events.list({ includeHidden: true });
      }),
      request.signal,
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ events: result.value });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.list", "Failed to list events", error);
  }
}

async function handlePOST(request: Request) {
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
        return yield* events.create(body as Record<string, unknown>);
      }),
      request.signal,
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    if (!result.value.ok) {
      return Response.json({ error: result.value.error }, { status: result.value.status });
    }
    return Response.json({ event: result.value.value }, { status: 201 });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.create", "Failed to create event", error);
  }
}

export const Route = createFileRoute("/api/admin/events")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
