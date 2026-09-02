import { createFileRoute } from "@tanstack/react-router";

const retired = () =>
  Response.json({ error: "Public score profiles have been retired" }, { status: 410 });

export const Route = createFileRoute("/api/tickets/$id/score/profile")({
  server: { handlers: { POST: retired } },
});
