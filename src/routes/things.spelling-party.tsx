import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/things/spelling-party")({
  beforeLoad: () => {
    throw redirect({ to: "/things/spelling-bee" });
  },
});
