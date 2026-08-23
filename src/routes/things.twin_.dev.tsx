import { createFileRoute } from "@tanstack/react-router";
import { TwinDevHarness } from "@/features/things/twin/TwinDevHarness";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/twin_/dev")({
  component: TwinDevHarness,
  head: () =>
    buildSeoHead({
      title: `Twin dev — ${SITE_NAME}`,
      description: "Development harness for Twin.",
      path: "/things/twin/dev",
      robots: "noindex, nofollow",
    }),
});
