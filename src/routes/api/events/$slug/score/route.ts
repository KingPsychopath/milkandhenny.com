import { createFileRoute } from "@tanstack/react-router";

import { activeParticipantForEvent } from "@/features/event-scoring/session.server";
import { publicLeaderboard } from "@/features/event-scoring/scoring.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, slug: string) {
  try {
    const currentParticipantId = await activeParticipantForEvent(slug);
    const result = await publicLeaderboard({ eventSlug: slug, currentParticipantId });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.value, {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.public-leaderboard",
      "Could not load the leaderboard",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/score")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.slug) } },
});
