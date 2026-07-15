import { createFileRoute } from "@tanstack/react-router";
import { SpellingBeeApp } from "@/features/things/spelling-bee/SpellingBeeApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/spelling-bee")({
  component: SpellingBeeApp,
  head: () => ({ meta: [{ title: `Spelling Bee — ${SITE_NAME}` }, { name: "description", content: "A local-first spelling bee with decks, tilt controls and an optional remote judge." }] }),
});
