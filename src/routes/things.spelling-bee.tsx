import { createFileRoute } from "@tanstack/react-router";
import { SpellingBeeApp } from "@/features/things/spelling-bee/SpellingBeeApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/spelling-bee")({
  component: SpellingBeeApp,
  head: () =>
    buildSeoHead({
      title: `Spelling Bee — ${SITE_NAME}`,
      description: "Hear the word, spell it aloud, or type together in a local-first spelling bee.",
      path: "/things/spelling-bee",
      image: OG_IMAGES.spellingBee,
      imageAlt: "Spelling Bee — a local-first word game from Milk & Henny",
    }),
});
