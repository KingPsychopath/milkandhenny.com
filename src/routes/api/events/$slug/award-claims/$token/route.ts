import { createFileRoute } from "@tanstack/react-router";

import { retiredScoringResponse } from "@/features/event-scoring/retired";

export const Route = createFileRoute("/api/events/$slug/award-claims/$token")({
  server: { handlers: { POST: () => retiredScoringResponse() } },
});

export const POST = retiredScoringResponse;
