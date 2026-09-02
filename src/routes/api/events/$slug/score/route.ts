import { createFileRoute } from "@tanstack/react-router";

const retired = () => Response.json({ error: "Event scoring has been retired" }, { status: 410 });

export const Route = createFileRoute("/api/events/$slug/score")({
  server: { handlers: { GET: retired } },
});
