import { createFileRoute } from "@tanstack/react-router";
import { SameBrainDevHarness } from "@/features/things/same-brain/SameBrainDevHarness";
import { requireDevelopmentRoute } from "@/features/things/shared/development-route";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

/**
 * Development only. The open question in this game is whether the scorer agrees with a human, and
 * that is only answerable by running the same answers through both methods and comparing the two
 * reveals side by side — which no arrangement of real phones makes convenient.
 */
export const Route = createFileRoute("/things/same-brain_/dev")({
  beforeLoad: requireDevelopmentRoute,
  component: SameBrainDevRoute,
  head: () =>
    buildSeoHead({
      title: `Same Brain dev — ${SITE_NAME}`,
      description: "Development harness for Same Brain.",
      path: "/things/same-brain/dev",
      robots: "noindex, nofollow",
    }),
});

function SameBrainDevRoute() {
  if (!import.meta.env.DEV) return null;
  return <SameBrainDevHarness />;
}
