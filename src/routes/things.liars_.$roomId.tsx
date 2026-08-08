import { createFileRoute } from "@tanstack/react-router";
import { LiarsRoomApp } from "@/features/things/liars/LiarsRoomApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/liars_/$roomId")({
  component: LiarsRoomRoute,
  head: () => ({ meta: [{ title: `Join Liars — ${SITE_NAME}` }] }),
});

function LiarsRoomRoute() {
  return <LiarsRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
