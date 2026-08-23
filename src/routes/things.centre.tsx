import { createFileRoute } from "@tanstack/react-router";
import { CentreApp } from "@/features/things/centre/CentreApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/centre")({
  component: CentreApp,
  head: () =>
    buildSeoHead({
      title: `Centre — ${SITE_NAME}`,
      description: "Trace a circular maze from the outside. First to the centre wins.",
      path: "/things/centre",
      image: OG_IMAGES.centre,
      imageAlt: "Centre — a circular maze race from Milk & Henny",
    }),
});
