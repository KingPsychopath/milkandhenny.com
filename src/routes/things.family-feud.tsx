import { createFileRoute } from "@tanstack/react-router";

import { FamilyFeudSetupApp } from "@/features/things/family-feud/FamilyFeudSetupApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/family-feud")({
  component: FamilyFeudSetupApp,
  head: () =>
    buildSeoHead({
      title: `Family Feud — ${SITE_NAME}`,
      description:
        "A host-led Family Feud game for two teams, one shared screen and no player phones.",
      path: "/things/family-feud",
      imageAlt: "Family Feud — a shared-screen team game",
    }),
});
