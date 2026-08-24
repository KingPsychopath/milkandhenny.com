import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryApp } from "@/features/things/draw-country/DrawCountryApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { selectSoloCountryFn } from "@/features/things/draw-country/draw-country-room.functions";
import { getDefaultGamePoolLaunchFn } from "@/features/things/pool/pool.functions";

function DrawCountryRoute() {
  const data = Route.useLoaderData();
  return <DrawCountryApp initialCountry={data.initialCountry} defaultPool={data.defaultPool} />;
}

export const Route = createFileRoute("/things/draw-country")({
  // An online first visit gets an instant first round without downloading the atlas. A prepared
  // offline visit can recover from its cached atlas inside the app instead of failing the route.
  loader: async () => {
    const [initialCountry, defaultPool] = await Promise.all([
      selectSoloCountryFn({ data: { recentCountryIds: [] } }).catch(() => null),
      getDefaultGamePoolLaunchFn({ data: { game: "draw-country" } }).catch(() => null),
    ]);
    return { initialCountry, defaultPool };
  },
  component: DrawCountryRoute,
  head: () =>
    buildSeoHead({
      title: `Draw the Country — ${SITE_NAME}`,
      description:
        "Draw country borders from memory, compare your outline, or compete live with friends.",
      path: "/things/draw-country",
      image: OG_IMAGES.drawCountry,
      imageAlt: "Draw the Country — a country outline drawing game from Milk & Henny",
    }),
});
