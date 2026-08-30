import { createFileRoute } from "@tanstack/react-router";
import { HotAndColdRoomRoute } from "@/features/things/hot-and-cold/HotAndColdRoomRoute";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import "@/features/things/hot-and-cold/hot-and-cold.css";

export const Route = createFileRoute("/things/hot-and-cold_/$roomId")({
  component: Page,
  head: ({ params }) =>
    buildSeoHead({
      title: `Hot & Cold room — ${SITE_NAME}`,
      description: "A private Hot & Cold multiplayer room.",
      path: `/things/hot-and-cold/${params.roomId}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function Page() {
  return <HotAndColdRoomRoute roomId={Route.useParams().roomId.toUpperCase()} />;
}
