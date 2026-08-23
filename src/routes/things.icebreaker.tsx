import { createFileRoute } from "@tanstack/react-router";
import { IcebreakerApp } from "@/features/things/icebreaker/IcebreakerApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/icebreaker")({
  component: IcebreakerApp,
  head: () =>
    buildSeoHead({
      title: `Icebreaker — ${SITE_NAME}`,
      description: "Reveal a colour, find your people, and break the ice.",
      path: "/things/icebreaker",
      image: OG_IMAGES.icebreaker,
      imageAlt: "Icebreaker — reveal a colour and find your people",
    }),
});
