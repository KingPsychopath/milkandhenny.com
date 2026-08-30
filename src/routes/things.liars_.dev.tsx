import { createFileRoute } from "@tanstack/react-router";
import { LiarsDevHarness } from "@/features/things/liars/LiarsDevHarness";
import { requireDevelopmentRoute } from "@/features/things/shared/development-route";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

/**
 * Development only. Five phones and a stopwatch is a poor loop for a game whose whole design is
 * about what each player can and cannot see; this puts the entire table on one screen.
 */
export const Route = createFileRoute("/things/liars_/dev")({
  beforeLoad: requireDevelopmentRoute,
  component: LiarsDevRoute,
  head: () =>
    buildSeoHead({
      title: `Liars dev — ${SITE_NAME}`,
      description: "Development harness for Liars.",
      path: "/things/liars/dev",
      robots: "noindex, nofollow",
    }),
});

function LiarsDevRoute() {
  if (!import.meta.env.DEV) return null;
  return <LiarsDevHarness />;
}
