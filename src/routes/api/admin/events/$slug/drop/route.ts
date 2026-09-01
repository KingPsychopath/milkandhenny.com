import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { updateEventOperationsPolicy } from "@/features/attendee-operations/capabilities.server";
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
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const [drop, schedule] = await Promise.all([
      runDrop(request, (service) => service.getDrop(slug)),
      runDrop(request, (service) => service.getDropSchedule(slug)),
    ]);
    return Response.json({ drop, schedule });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.drop", "Failed to load guest uploads", error);
  }
}

async function handlePOST(request: Request, slug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
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

    const actorId = auth.actorId ?? "root-owner";
    await updateEventOperationsPolicy({
      eventSlug: slug,
      capabilities: { guestPhotos: true },
      actorId,
      actorType: auth.actorType === "admin" ? "admin" : "root-owner",
      reason: "Guest album enabled from event controls",
    });
    const opensAt = typeof record.opensAt === "string" ? record.opensAt : undefined;
    const result = opensAt
      ? await runDrop(request, (service) =>
          service.scheduleDrop({ eventSlug: slug, opensAt, expirySeconds, actorId }),
        )
      : await runDrop(request, (service) =>
          service
            .cancelDropSchedule(slug)
            .pipe(Effect.andThen(service.enableDrop(slug, expirySeconds))),
        );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(opensAt ? { schedule: result.value } : { drop: result.value });
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
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    await runDrop(request, (service) => service.cancelDropSchedule(slug));
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
