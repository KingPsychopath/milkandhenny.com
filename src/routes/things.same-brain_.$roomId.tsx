import { createFileRoute } from "@tanstack/react-router";
import { SameBrainRoomApp } from "@/features/things/same-brain/SameBrainRoomApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/same-brain_/$roomId")({
  component: SameBrainRoomRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Join Same Brain — ${SITE_NAME}`,
      description: "Join a private Same Brain game from your phone.",
      path: `/things/same-brain/${params.roomId}`,
      image: OG_IMAGES.sameBrain,
      robots: "noindex, nofollow",
    }),
});

function SameBrainRoomRoute() {
  return <SameBrainRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
