import { createFileRoute } from "@tanstack/react-router";
import { HeadsUpApp } from "@/features/things/heads-up/HeadsUpApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/heads-up")({
  component: HeadsUpApp,
  head: () =>
    buildSeoHead({
      title: `Heads Up — ${SITE_NAME}`,
      description: "A fast, tilt-controlled guessing game for friends.",
      path: "/things/heads-up",
      image: OG_IMAGES.forehead,
      imageAlt: "Heads Up — a fast guessing game for friends from Milk & Henny",
    }),
});
