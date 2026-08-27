import { createFileRoute } from "@tanstack/react-router";

import { TwinApp } from "@/features/things/twin/TwinApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/twin_/one-screen")({
  ssr: false,
  component: TwinOneScreenRoute,
  head: () =>
    buildSeoHead({
      title: `Twin on one screen — ${SITE_NAME}`,
      description: "Two people race to find the shared symbol on one screen.",
      path: "/things/twin/one-screen",
      image: OG_IMAGES.twin,
    }),
});

function TwinOneScreenRoute() {
  return <TwinApp initialBoard="duel" />;
}
