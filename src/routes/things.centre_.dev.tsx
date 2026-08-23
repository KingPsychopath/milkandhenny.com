import { createFileRoute } from "@tanstack/react-router";
import { CentreDevHarness } from "@/features/things/centre/CentreDevHarness";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/centre_/dev")({
  component: CentreDevHarness,
  head: () =>
    buildSeoHead({
      title: `Centre dev — ${SITE_NAME}`,
      description: "Development harness for Centre.",
      path: "/things/centre/dev",
      robots: "noindex, nofollow",
    }),
});
