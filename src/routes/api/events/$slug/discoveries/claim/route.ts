import { createFileRoute } from "@tanstack/react-router";

import { retiredScoringResponse } from "@/features/event-scoring/retired";

export const Route = createFileRoute("/api/events/$slug/discoveries/claim")({
  server: { handlers: { POST: () => retiredScoringResponse() } },
});
