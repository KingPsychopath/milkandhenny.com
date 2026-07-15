import { createFileRoute } from "@tanstack/react-router";
import { RemotePlayerJoinApp } from "@/features/things/remote/RemotePlayerJoinApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/play/$roomId")({
  component: PlayerRoute,
  head: () => ({
    meta: [
      { title: `Join game — ${SITE_NAME}` },
      { name: "description", content: "Open a game prepared by your remote judge." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function PlayerRoute() {
  const { roomId } = Route.useParams();
  return <RemotePlayerJoinApp roomId={roomId.toUpperCase()} />;
}
