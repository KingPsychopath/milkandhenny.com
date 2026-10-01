import { createFileRoute } from "@tanstack/react-router";
import { PairsRaceApp } from "@/features/things/pairs/PairsRaceApp";
import { multiplayerRoomId } from "@/features/things/shared/multiplayer-validation";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pairs_/race/$roomId")({
  ssr: false,
  beforeLoad: ({ params }) => {
    multiplayerRoomId(params.roomId);
  },
  component: () => <PairsRaceApp roomId={Route.useParams().roomId.toUpperCase()} />,
  head: () =>
    buildSeoHead({
      title: "Pairs race — Milk & Henny",
      description: "Two devices. Same shuffle. First to clear the table wins the round.",
      path: "/things/pairs",
      robots: "noindex, nofollow",
    }),
});
