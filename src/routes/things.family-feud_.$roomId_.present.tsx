import { createFileRoute } from "@tanstack/react-router";

import { FamilyFeudPresenterApp } from "@/features/things/family-feud/FamilyFeudPresenterApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/family-feud_/$roomId_/present")({
  component: FamilyFeudPresenterRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Present Family Feud — ${SITE_NAME}`,
      description: "Private shared-screen Family Feud room.",
      path: `/things/family-feud/${params.roomId}/present`,
      robots: "noindex, nofollow",
    }),
});

function FamilyFeudPresenterRoute() {
  return <FamilyFeudPresenterApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
