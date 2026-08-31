import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";

import { claimStaffAward } from "@/features/event-scoring/staff-award-claims.server";
import {
  activeParticipantForEvent,
  openAttendeeTicket,
} from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { rateLimitClaim } from "@/features/tickets/tickets.server";

async function handlePOST(request: Request, eventSlug: string, token: string) {
  try {
    if (!(await rateLimitClaim(getRequestIP() || "unknown"))) {
      return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
    if (!/^award_[A-Za-z0-9_-]{32,80}$/.test(token)) {
      return Response.json({ error: "Award QR not found" }, { status: 404 });
    }
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const ticketId = typeof record.ticketId === "string" ? record.ticketId : undefined;
    const opened = ticketId
      ? await openAttendeeTicket({ ticketId, eventSlug, mode: "scoring" })
      : null;
    const participantId =
      opened?.ticket.participantId ?? (await activeParticipantForEvent(eventSlug));
    if (!participantId) {
      return Response.json(
        { error: "Open or choose the ticket receiving these points" },
        { status: 401 },
      );
    }
    const result = await claimStaffAward({ eventSlug, token, participantId });
    return result.ok
      ? Response.json(
          { points: result.value.points, transactionId: result.value.transaction.id },
          { headers: { "Cache-Control": "no-store" } },
        )
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.staff-award-claim",
      "Could not claim the points",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/award-claims/$token")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.slug, params.token),
    },
  },
});

export { handlePOST as POST };
