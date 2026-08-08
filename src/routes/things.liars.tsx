import { createFileRoute } from "@tanstack/react-router";
import { LiarsSetupApp } from "@/features/things/liars/LiarsSetupApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/liars")({
  component: LiarsSetupRoute,
  head: () => ({
    meta: [
      { title: `Liars: Mafia and Imposter — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Two social deduction games in one room, for 4 to 16 phones. Everyone acts every night, and nobody has to keep score.",
      },
    ],
  }),
});

function LiarsSetupRoute() {
  return <LiarsSetupApp />;
}
