import { createFileRoute } from "@tanstack/react-router";
import { PartyPlayerApp } from "@/features/things/spelling-party/PartyPlayerApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/spelling-party_/$roomId")({
  component: PartyPlayerRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Join Party Typing — ${SITE_NAME}`,
      description: "Join a private Type Together spelling game from your phone.",
      path: `/things/spelling-party/${params.roomId}`,
      image: OG_IMAGES.spellingParty,
      robots: "noindex, nofollow",
    }),
});
function PartyPlayerRoute() {
  return <PartyPlayerApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
