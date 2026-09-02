import { createFileRoute } from "@tanstack/react-router";

import { retiredScoringResponse } from "@/features/event-scoring/retired";

export const Route = createFileRoute("/api/tickets/$id/session")({
  server: {
    handlers: {
      GET: () => retiredScoringResponse(),
      POST: () => retiredScoringResponse(),
    },
  },
});
