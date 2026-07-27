import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The first-birthday party page lived here.
 *
 * The URL is kept and redirected rather than deleted: it was printed and
 * shared, and a dead link is a worse outcome than a redirect to whatever is
 * on next.
 */
export const Route = createFileRoute("/party")({
  beforeLoad: () => {
    throw redirect({ to: "/events", statusCode: 301 });
  },
});
