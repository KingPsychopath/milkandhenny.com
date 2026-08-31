import { createFileRoute } from "@tanstack/react-router";
import { PartyPresenterApp } from "@/features/things/spelling-party/PartyPresenterApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/spelling-party_/$roomId_/present")({
  component: PartyPresenterRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Present Party Typing — ${SITE_NAME}`,
      description: "Present a private multiplayer spelling game on the big screen.",
      path: `/things/spelling-party/${params.roomId}/present`,
      image: OG_IMAGES.spellingParty,
      robots: "noindex, nofollow",
    }),
});
function PartyPresenterRoute() {
  return <PartyPresenterApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
