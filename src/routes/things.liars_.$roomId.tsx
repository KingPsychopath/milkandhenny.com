import { createFileRoute } from "@tanstack/react-router";
import { LiarsRoomApp } from "@/features/things/liars/LiarsRoomApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/liars_/$roomId")({
  component: LiarsRoomRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Join Liars — ${SITE_NAME}`,
      description: "Join a private Liars game from your phone.",
      path: `/things/liars/${params.roomId}`,
      image: OG_IMAGES.liars,
      robots: "noindex, nofollow",
    }),
});

function LiarsRoomRoute() {
  return <LiarsRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
