import { createFileRoute } from "@tanstack/react-router";

import { retiredScoringResponse } from "@/features/event-scoring/retired";

export const Route = createFileRoute("/api/events/$slug/discoveries/$discoveryId/claim")({
  server: { handlers: { POST: () => retiredScoringResponse() } },
});
