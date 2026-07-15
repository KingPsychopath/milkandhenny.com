import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/icebreaker")({
  beforeLoad: () => {
    throw redirect({ to: "/things/icebreaker", replace: true });
  },
});
