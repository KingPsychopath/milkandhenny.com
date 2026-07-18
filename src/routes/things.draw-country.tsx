import { createFileRoute } from "@tanstack/react-router";
import { DrawCountryApp } from "@/features/things/draw-country/DrawCountryApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/draw-country")({
  component: DrawCountryApp,
  head: () => ({
    meta: [
      { title: `Draw the Country — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Draw country borders from memory, compare your outline, or compete in a shared room.",
      },
    ],
  }),
});
