import { createFileRoute } from "@tanstack/react-router";

import { getDiscovery } from "@/features/event-scoring/discoveries.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, slug: string, discoveryId: string) {
  try {
    const discovery = await getDiscovery(discoveryId);
    if (!discovery || discovery.eventSlug !== slug) {
      return Response.json({ error: "Discovery not found" }, { status: 404 });
    }
    return Response.json(
      {
        id: discovery.id,
        eventSlug: discovery.eventSlug,
        activityId: discovery.activityId,
        name: discovery.name,
        method: discovery.method,
        status: discovery.status,
        rule: discovery.rule,
        replacementRevision: discovery.replacementRevision,
      },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
    );
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.discovery.read",
      "Could not load the discovery",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/discoveries/$discoveryId")({
  server: {
    handlers: { GET: ({ request, params }) => handleGET(request, params.slug, params.discoveryId) },
  },
});
