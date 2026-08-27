import { createFileRoute } from "@tanstack/react-router";

import { DrawCountryApp } from "@/features/things/draw-country/DrawCountryApp";
import { selectSoloCountryFn } from "@/features/things/draw-country/draw-country-room.functions";
import type { SoloDrawCountryMode } from "@/features/things/draw-country/SoloDrawCountry";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/draw-country_/solo")({
  validateSearch: (search: Record<string, unknown>): { mode: SoloDrawCountryMode } => ({
    mode: search.mode === "rounds" ? "rounds" : "quick",
  }),
  loader: () => selectSoloCountryFn({ data: { recentCountryIds: [] } }).catch(() => null),
  component: DrawCountrySoloRoute,
  head: () =>
    buildSeoHead({
      title: `Draw the Country solo — ${SITE_NAME}`,
      description: "Draw country borders from memory and compare your outline.",
      path: "/things/draw-country/solo",
      image: OG_IMAGES.drawCountry,
    }),
});

function DrawCountrySoloRoute() {
  return (
    <DrawCountryApp
      initialCountry={Route.useLoaderData()}
      initialSoloMode={Route.useSearch().mode}
    />
  );
}
