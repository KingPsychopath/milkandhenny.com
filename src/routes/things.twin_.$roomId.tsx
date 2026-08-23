import { createFileRoute } from "@tanstack/react-router";
import { TwinRoomApp } from "@/features/things/twin/TwinRoomApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/twin_/$roomId")({
  component: TwinRoomRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Twin room — ${SITE_NAME}`,
      description: "Join a shared game of Twin.",
      path: `/things/twin/${params.roomId}`,
      image: OG_IMAGES.twin,
      robots: "noindex, nofollow",
    }),
});

function TwinRoomRoute() {
  const { roomId } = Route.useParams();
  return <TwinRoomApp roomId={roomId.toUpperCase()} />;
}
