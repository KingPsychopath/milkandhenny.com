import { createFileRoute } from "@tanstack/react-router";

const retired = () =>
  Response.json({ error: "Event scoring updates have been retired" }, { status: 410 });

export const Route = createFileRoute("/api/tickets/$id/score/events")({
  server: { handlers: { GET: retired } },
});

export { retired as GET };
