import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";

import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import {
  activeParticipantForEvent,
  openAttendeeTicket,
  openedParticipantForEvent,
} from "@/features/event-scoring/session.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { rateLimitClaim } from "@/features/tickets/tickets.server";

async function handlePOST(request: Request, slug: string, discoveryId: string) {
  try {
    if (!(await rateLimitClaim(getRequestIP() || "unknown"))) {
      return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const presented = typeof record.presented === "string" ? record.presented : "";
    const commandId = typeof record.commandId === "string" ? record.commandId : "";
    if (!presented || !/^[A-Za-z0-9_-]{16,100}$/.test(commandId)) {
      return Response.json({ error: "Enter the clue and try again" }, { status: 400 });
    }
    const discovery = await runEventsEffect(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.getDiscovery(discoveryId);
      }),
      request.signal,
    );
    if (!discovery || discovery.eventSlug !== slug)
      return Response.json({ error: "Discovery not found" }, { status: 404 });
    const ticketId = typeof record.ticketId === "string" ? record.ticketId : undefined;
    const selected = ticketId
      ? await openAttendeeTicket({
          ticketId,
          eventSlug: slug,
          mode: discovery.rule.pointMode === "none" ? "view-only" : "scoring",
        })
      : null;
    const participantId =
      selected?.ticket.participantId ??
      (discovery.rule.pointMode === "none"
        ? await openedParticipantForEvent(slug, ticketId)
        : await activeParticipantForEvent(slug));
    if (!participantId)
      return Response.json(
        {
          error:
            discovery.rule.pointMode === "none"
              ? "Choose the ticket playing this hunt"
              : "Choose a ticket for event points before claiming this clue",
        },
        { status: 401 },
      );
    const result = await runEventsEffect(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.claimDiscovery({
          discoveryId,
          participantId,
          presented,
          commandId,
        });
      }),
      request.signal,
    );
    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          retryAt: result.retryAt,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        {
          status: result.status,
          headers: {
            "Cache-Control": "no-store",
            ...(result.retryAfterSeconds
              ? { "Retry-After": String(result.retryAfterSeconds) }
              : {}),
          },
        },
      );
    }
    return Response.json(result.value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.discovery-claim",
      "Could not claim the clue",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/discoveries/$discoveryId/claim")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.slug, params.discoveryId),
    },
  },
});
