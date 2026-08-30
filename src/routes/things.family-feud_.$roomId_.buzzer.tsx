import { createFileRoute } from "@tanstack/react-router";

import { FamilyFeudBuzzerApp } from "@/features/things/family-feud/FamilyFeudBuzzerApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/family-feud_/$roomId_/buzzer")({
  component: FamilyFeudBuzzerRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Family Feud Buzzer — ${SITE_NAME}`,
      description: "Private shared Family Feud buzzer.",
      path: `/things/family-feud/${params.roomId}/buzzer`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function FamilyFeudBuzzerRoute() {
  return <FamilyFeudBuzzerApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
