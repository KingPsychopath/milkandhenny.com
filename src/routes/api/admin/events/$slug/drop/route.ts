import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { parseExpiry } from "@/features/transfers/store.server";

/** Admin control of an event's guest media drop. */

function runDrop<A>(
  request: Request,
  use: (service: typeof EventOperationsService.Service) => Effect.Effect<A, unknown>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* EventOperationsService);
    }),
    request.signal,
  );
}

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const drop = await runDrop(request, (service) => service.getDrop(slug));
    return Response.json({ drop });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.drop", "Failed to load guest uploads", error);
  }
}

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const expiry = typeof record.expiry === "string" ? record.expiry : "7d";

    let expirySeconds: number;
    try {
      expirySeconds = parseExpiry(expiry);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Invalid expiry" },
        { status: 400 },
      );
    }

    const result = await runDrop(request, (service) => service.enableDrop(slug, expirySeconds));
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ drop: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.drop",
      "Failed to enable guest uploads",
      error,
    );
  }
}

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const result = await runDrop(request, (service) => service.disableDrop(slug));
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.drop",
      "Failed to disable guest uploads",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/drop")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
      DELETE: ({ request, params }) => handleDELETE(request, params.slug),
    },
  },
});
