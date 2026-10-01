import { createFileRoute } from "@tanstack/react-router";
import { PairsApp } from "@/features/things/pairs/PairsApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pairs")({
  component: PairsApp,
  head: () =>
    buildSeoHead({
      title: `Pairs — ${SITE_NAME}`,
      description:
        "Flip two cards, find the pairs, and watch the table fall away. Play solo or take turns with friends on one device.",
      path: "/things/pairs",
    }),
});
