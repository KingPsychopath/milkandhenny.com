import { createFileRoute } from "@tanstack/react-router";
import { SameBrainSetupApp } from "@/features/things/same-brain/SameBrainSetupApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/same-brain")({
  component: SameBrainSetupRoute,
  head: () => ({
    meta: [
      { title: `Same Brain — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Everyone answers the same question on their own phone. Answer like everyone else and score together — try not to be the odd one out. For 3 to 16 people.",
      },
    ],
  }),
});

function SameBrainSetupRoute() {
  return <SameBrainSetupApp />;
}
