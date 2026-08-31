import { createFileRoute } from "@tanstack/react-router";
import { LiarsSetupApp } from "@/features/things/liars/LiarsSetupApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/imposter")({
  component: ImposterSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Imposter — ${SITE_NAME}`,
      description:
        "Play Imposter with 4 to 16 people. Everyone knows the secret word except the player trying to blend in.",
      path: "/things/imposter",
      image: OG_IMAGES.liars,
      imageAlt: "Imposter — a social deduction game from Milk & Henny",
    }),
});

function ImposterSetupRoute() {
  return <LiarsSetupApp mode="imposter" />;
}
