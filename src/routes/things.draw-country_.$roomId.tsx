import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryRoomApp } from "@/features/things/draw-country/DrawCountryRoomApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/draw-country_/$roomId")({
  component: DrawCountryRoomRoute,
  head: () => ({ meta: [{ title: `Draw the Country Together — ${SITE_NAME}` }] }),
});

function DrawCountryRoomRoute() {
  return <DrawCountryRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
