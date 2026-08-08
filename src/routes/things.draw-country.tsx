import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryApp } from "@/features/things/draw-country/DrawCountryApp";
import { SITE_NAME } from "@/lib/shared/config";
import { selectSoloCountryFn } from "@/features/things/draw-country/draw-country-room.functions";

function DrawCountryRoute() {
  return <DrawCountryApp initialCountry={Route.useLoaderData()} />;
}

export const Route = createFileRoute("/things/draw-country")({
  loader: () => selectSoloCountryFn({ data: { recentCountryIds: [] } }),
  component: DrawCountryRoute,
  head: () => ({
    meta: [
      { title: `Draw the Country — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Draw country borders from memory, compare your outline, or compete in a shared room.",
      },
    ],
  }),
});
