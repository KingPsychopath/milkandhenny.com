import { createFileRoute } from "@tanstack/react-router";

import { CentreApp } from "@/features/things/centre/CentreApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";

type CentreSoloMode = "new" | "daily" | "ghost";

export const Route = createFileRoute("/things/centre_/solo")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode: CentreSoloMode } => ({
    mode: search.mode === "daily" || search.mode === "ghost" ? search.mode : "new",
  }),
  component: CentreSoloRoute,
  head: () =>
    buildSeoHead({
      title: `Centre solo — ${SITE_NAME}`,
      description: "Trace a circular maze from the outside and race to the centre.",
      path: "/things/centre/solo",
      image: OG_IMAGES.centre,
    }),
});

function CentreSoloRoute() {
  return <CentreApp initialSolo={Route.useSearch().mode} />;
}
