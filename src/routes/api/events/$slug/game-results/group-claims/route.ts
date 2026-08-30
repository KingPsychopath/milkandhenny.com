import { createFileRoute } from "@tanstack/react-router";

import {
  claimGroupGameResult,
  readGroupGameClaimSession,
} from "@/features/event-scoring/group-game-claims.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";

export const Route = createFileRoute("/api/events/$slug/game-results/group-claims")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const body = (await request.json().catch(() => null)) as {
          operation?: unknown;
          token?: unknown;
        } | null;
        if (typeof body?.token !== "string")
          return Response.json({ error: "A team claim token is required" }, { status: 400 });
        if (body.operation === "preview") {
          const result = await readGroupGameClaimSession({
            eventSlug: params.slug,
            token: body.token,
          });
          return result.ok
            ? Response.json(result.value)
            : Response.json({ error: result.error }, { status: result.status });
        }
        if (body.operation === "claim") {
          const participantId = await activeParticipantForEvent(params.slug);
          if (!participantId)
            return Response.json(
              {
                error: "Open your event ticket on this phone, then scan the team code again.",
              },
              { status: 401 },
            );
          const result = await claimGroupGameResult({
            eventSlug: params.slug,
            token: body.token,
            targetParticipantId: participantId,
          });
          return result.ok
            ? Response.json(result.value)
            : Response.json({ error: result.error }, { status: result.status });
        }
        return Response.json({ error: "Invalid claim operation" }, { status: 400 });
      },
    },
  },
});
