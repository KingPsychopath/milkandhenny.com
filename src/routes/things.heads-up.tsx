import { createFileRoute } from "@tanstack/react-router";
import { HeadsUpApp } from "@/features/things/heads-up/HeadsUpApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/heads-up")({
  component: HeadsUpApp,
  head: () => ({
    meta: [
      { title: `Forehead — ${SITE_NAME}` },
      { name: "description", content: "A fast, tilt-controlled guessing game for friends." },
    ],
  }),
});
