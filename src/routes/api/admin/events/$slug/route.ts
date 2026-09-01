import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import {
  requireAdminStepUp,
  requireAuth,
  requireAuthWithPayload,
} from "@/features/auth/auth.server";
import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { EventsService } from "@/features/events/events-service.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import { runEventsResult as runEventOperationsResult } from "@/features/events/events-runtime.server";
import { log } from "@/lib/platform/logger.server";

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
    const result = await runEventOperationsResult(
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
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const cancellationCheck = await runEventOperationsResult(
      Effect.gen(function* () {
        const operations = yield* EventOperationsService;
        return yield* operations.cancellationPending(slug, record.status);
      }),
    );
    if (!cancellationCheck.ok)
      return Response.json(
        { error: cancellationCheck.error },
        { status: cancellationCheck.status },
      );
    const cancelling = cancellationCheck.value;
    if (cancelling) {
      const stepUp = await requireAdminStepUp(request);
      if (stepUp) return stepUp;
      if (typeof record.cancellationReason !== "string" || !record.cancellationReason.trim())
        return Response.json({ error: "A cancellation reason is required" }, { status: 400 });
    }

    const result = await runEventOperationsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        const operations = yield* EventOperationsService;
        const updated = yield* events.update(slug, record);
        if (!updated.ok) return { updated } as const;
        const cancellation = cancelling
          ? yield* operations.cancelEvent({
              eventSlug: updated.value.slug,
              actorId: auth.actorId ?? "root-owner",
              actorType: auth.actorType === "admin" ? "admin" : "root-owner",
              reason: record.cancellationReason as string,
              origin: new URL(request.url).origin,
            })
          : undefined;
        const waitlistNotifications = yield* operations
          .reconcileWaitlist({
            eventSlug: updated.value.slug,
            origin: new URL(request.url).origin,
          })
          .pipe(
            Effect.map((outcome) => outcome.count),
            Effect.catch((error) =>
              Effect.sync(() => {
                log.error(
                  "events.waitlist",
                  "Immediate waitlist reconciliation failed",
                  { eventSlug: updated.value.slug },
                  error,
                );
                return 0;
              }),
            ),
          );
        return { updated, cancellation, waitlistNotifications } as const;
      }),
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    if (!result.value.updated.ok) {
      return Response.json(
        { error: result.value.updated.error },
        { status: result.value.updated.status },
      );
    }
    return Response.json({
      event: result.value.updated.value,
      cancellation: result.value.cancellation,
      waitlistNotifications: result.value.waitlistNotifications,
    });
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
    const result = await runEventOperationsResult(
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
