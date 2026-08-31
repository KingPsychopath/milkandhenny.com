import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/things/liars")({
  beforeLoad: () => {
    throw redirect({ to: "/things/mafia", replace: true, statusCode: 301 });
  },
});
