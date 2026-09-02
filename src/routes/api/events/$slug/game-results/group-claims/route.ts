import { createFileRoute } from "@tanstack/react-router";

import { retiredScoringResponse } from "@/features/event-scoring/retired";

export const Route = createFileRoute("/api/events/$slug/game-results/group-claims")({
  server: { handlers: { POST: () => retiredScoringResponse() } },
});
