import { createFileRoute } from "@tanstack/react-router";
import { TwinRoomApp } from "@/features/things/twin/TwinRoomApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/twin_/$roomId")({
  component: TwinRoomRoute,
  head: () => ({
    meta: [
      { title: `Twin room — ${SITE_NAME}` },
      { name: "description", content: "Join a shared game of twin." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function TwinRoomRoute() {
  const { roomId } = Route.useParams();
  return <TwinRoomApp roomId={roomId.toUpperCase()} />;
}
