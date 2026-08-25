import { createFileRoute } from "@tanstack/react-router";

import {
  claimTicketForPerson,
  releaseOwnTicketClaim,
} from "@/features/attendee-access/access.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, ticketId: string): Promise<Response> {
  try {
    const session = await getAttendeeSession();
    if (!session?.personId || !session.verifiedEmailHash)
      return Response.json({ error: "Verify your email first" }, { status: 401 });
    const access = session.tickets.find((entry) => entry.ticketId === ticketId);
    if (!access)
      return Response.json({ error: "Open this ticket on this device first" }, { status: 403 });
    const result = await claimTicketForPerson({
      personId: session.personId,
      verifiedEmailHash: session.verifiedEmailHash,
      ticketId,
      permittedParticipantId: access.participantId,
    });
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.ticket.claim",
      "The ticket could not be claimed",
      error,
    );
  }
}

async function handleDELETE(request: Request, ticketId: string): Promise<Response> {
  try {
    const session = await getAttendeeSession();
    if (!session?.personId) return Response.json({ error: "Sign in first" }, { status: 401 });
    const result = await releaseOwnTicketClaim({ personId: session.personId, ticketId });
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.ticket.release",
      "The ticket claim could not be changed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/identity")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.id),
      DELETE: ({ request, params }) => handleDELETE(request, params.id),
    },
  },
});

export { handleDELETE as DELETE, handlePOST as POST };
