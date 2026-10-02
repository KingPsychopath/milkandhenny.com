import { createFileRoute } from "@tanstack/react-router";
import { PairsDevHarness } from "@/features/things/pairs/PairsDevHarness";
import { requireDevelopmentRoute } from "@/features/things/shared/development-route";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pairs_/dev")({
  beforeLoad: requireDevelopmentRoute,
  component: PairsDevHarness,
  head: () =>
    buildSeoHead({
      title: "Pairs development",
      description: "Deterministic single-device Pairs scenarios.",
      path: "/things/pairs/dev",
      robots: "noindex, nofollow",
    }),
});
