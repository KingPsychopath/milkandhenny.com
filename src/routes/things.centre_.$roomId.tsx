import { createFileRoute } from "@tanstack/react-router";
import { CentreRoomApp } from "@/features/things/centre/CentreRoomApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/centre_/$roomId")({
  component: CentreRoomRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Centre room — ${SITE_NAME}`,
      description: "Join a shared circular maze race.",
      path: `/things/centre/${params.roomId}`,
      image: OG_IMAGES.centre,
      robots: "noindex, nofollow",
    }),
});

function CentreRoomRoute() {
  const { roomId } = Route.useParams();
  return <CentreRoomApp roomId={roomId.toUpperCase()} />;
}
