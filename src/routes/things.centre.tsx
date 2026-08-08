import { createFileRoute } from "@tanstack/react-router";
import { CentreApp } from "@/features/things/centre/CentreApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/centre")({
  component: CentreApp,
  head: () => ({
    meta: [
      { title: `Centre — ${SITE_NAME}` },
      {
        name: "description",
        content: "Trace a circular maze from the outside. First to the centre wins.",
      },
    ],
  }),
});
