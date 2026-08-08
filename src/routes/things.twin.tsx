import { createFileRoute } from "@tanstack/react-router";
import { TwinApp } from "@/features/things/twin/TwinApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/twin")({
  component: TwinApp,
  head: () => ({
    meta: [
      { title: `Twin — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Every two cards share exactly one symbol. Find it first, put your card down, and empty your hand.",
      },
    ],
  }),
});
