import { createFileRoute } from "@tanstack/react-router";

import { SameBrainSetupApp } from "@/features/things/same-brain/SameBrainSetupApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/same-brain_/solo")({
  ssr: false,
  component: SameBrainSoloRoute,
  head: () =>
    buildSeoHead({
      title: `Same Brain on one phone — ${SITE_NAME}`,
      description: "Play Same Brain together using one phone for the questions.",
      path: "/things/same-brain/solo",
      image: OG_IMAGES.sameBrain,
    }),
});

function SameBrainSoloRoute() {
  return <SameBrainSetupApp initialSolo />;
}
