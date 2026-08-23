import { createFileRoute } from "@tanstack/react-router";
import { RemotePlayerJoinApp } from "@/features/things/remote/RemotePlayerJoinApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/play/$roomId")({
  component: PlayerRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Join game — ${SITE_NAME}`,
      description: "Open a private game prepared by your remote judge.",
      path: `/things/play/${params.roomId}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function PlayerRoute() {
  const { roomId } = Route.useParams();
  return <RemotePlayerJoinApp roomId={roomId.toUpperCase()} />;
}
