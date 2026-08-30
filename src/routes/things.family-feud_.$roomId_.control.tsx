import { createFileRoute } from "@tanstack/react-router";

import { FamilyFeudControllerApp } from "@/features/things/family-feud/FamilyFeudControllerApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/family-feud_/$roomId_/control")({
  component: FamilyFeudControllerRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Control Family Feud — ${SITE_NAME}`,
      description: "Private Family Feud MC controls.",
      path: `/things/family-feud/${params.roomId}/control`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function FamilyFeudControllerRoute() {
  return <FamilyFeudControllerApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
