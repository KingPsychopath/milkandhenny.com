import { createFileRoute } from "@tanstack/react-router";

import { claimGamePlayerResult } from "@/features/event-scoring/game-claims.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";

export const Route = createFileRoute("/api/events/$slug/game-results/claim")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const participantId = await activeParticipantForEvent(params.slug);
        if (!participantId)
          return Response.json({ error: "Open your ticket first" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
        if (typeof body?.token !== "string") {
          return Response.json({ error: "A game result claim token is required" }, { status: 400 });
        }
        const result = await claimGamePlayerResult({
          token: body.token,
          targetParticipantId: participantId,
        });
        return result.ok
          ? Response.json(result.value)
          : Response.json({ error: result.error }, { status: result.status });
      },
    },
  },
});
