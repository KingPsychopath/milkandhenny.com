import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/things/liars_/phone")({
  beforeLoad: () => {
    throw redirect({ to: "/things/imposter/phone", replace: true, statusCode: 301 });
  },
});
