import { createFileRoute } from "@tanstack/react-router";
import { LiarsSetupApp } from "@/features/things/liars/LiarsSetupApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/mafia")({
  component: MafiaSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Mafia — ${SITE_NAME}`,
      description:
        "Play Mafia with 5 to 16 people. Everyone acts from their own phone while the game runs the night.",
      path: "/things/mafia",
      image: OG_IMAGES.liars,
      imageAlt: "Mafia — a social deduction game from Milk & Henny",
    }),
});

function MafiaSetupRoute() {
  return <LiarsSetupApp mode="mafia" />;
}
