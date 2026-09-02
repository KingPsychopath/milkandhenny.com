import { createFileRoute } from "@tanstack/react-router";

const retired = () =>
  Response.json({ error: "Event score notifications have been retired" }, { status: 410 });

export const Route = createFileRoute("/api/tickets/$id/score/notifications")({
  server: { handlers: { GET: retired, POST: retired } },
});
