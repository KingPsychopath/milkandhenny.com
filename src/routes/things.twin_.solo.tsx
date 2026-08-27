import { createFileRoute } from "@tanstack/react-router";

import { TwinApp } from "@/features/things/twin/TwinApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/twin_/solo")({
  ssr: false,
  component: TwinSoloRoute,
  head: () =>
    buildSeoHead({
      title: `Twin solo — ${SITE_NAME}`,
      description: "Practise finding the shared symbol on your own.",
      path: "/things/twin/solo",
      image: OG_IMAGES.twin,
    }),
});

function TwinSoloRoute() {
  return <TwinApp initialBoard="solo" />;
}
