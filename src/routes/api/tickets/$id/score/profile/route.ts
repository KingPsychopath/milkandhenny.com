import { createFileRoute } from "@tanstack/react-router";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { updateParticipantPublicIdentity } from "@/features/event-scoring/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, ticketId: string) {
  try {
    const session = await getAttendeeSession();
    const access = session?.tickets.find(
      (entry) => entry.ticketId === ticketId && entry.mode === "scoring",
    );
    if (!access)
      return Response.json({ error: "Choose this as your ticket first" }, { status: 403 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const displayMode = body?.displayMode;
    if (displayMode !== "alias" && displayMode !== "anonymous" && displayMode !== "hidden")
      return Response.json({ error: "Choose a valid public display option" }, { status: 400 });
    const result = await updateParticipantPublicIdentity({
      eventSlug: access.eventSlug,
      participantId: access.participantId,
      displayMode,
      publicAlias:
        typeof body?.publicAlias === "string" || body?.publicAlias === null
          ? body.publicAlias
          : undefined,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.public-identity",
      "Could not update the public score name",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/score/profile")({
  server: { handlers: { POST: ({ request, params }) => handlePOST(request, params.id) } },
});
