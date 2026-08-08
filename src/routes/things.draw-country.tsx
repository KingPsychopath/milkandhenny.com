import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryApp } from "@/features/things/draw-country/DrawCountryApp";
import { SITE_NAME } from "@/lib/shared/config";
import { selectSoloCountryFn } from "@/features/things/draw-country/draw-country-room.functions";

function DrawCountryRoute() {
  return <DrawCountryApp initialCountry={Route.useLoaderData()} />;
}

export const Route = createFileRoute("/things/draw-country")({
  // An online first visit gets an instant first round without downloading the atlas. A prepared
  // offline visit can recover from its cached atlas inside the app instead of failing the route.
  loader: () => selectSoloCountryFn({ data: { recentCountryIds: [] } }).catch(() => null),
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
