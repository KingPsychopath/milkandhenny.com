import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryRoomApp } from "@/features/things/draw-country/DrawCountryRoomApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/draw-country_/$roomId")({
  component: DrawCountryRoomRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Draw the Country Together — ${SITE_NAME}`,
      description: "Join a shared country drawing game.",
      path: `/things/draw-country/${params.roomId}`,
      image: OG_IMAGES.drawCountry,
      robots: "noindex, nofollow",
    }),
});

function DrawCountryRoomRoute() {
  return <DrawCountryRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
