import { createFileRoute } from "@tanstack/react-router";
import { TwinApp } from "@/features/things/twin/TwinApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/twin")({
  component: TwinApp,
  head: () =>
    buildSeoHead({
      title: `Twin — ${SITE_NAME}`,
      description: "Two cards share one symbol. Find it first and empty your hand.",
      path: "/things/twin",
      image: OG_IMAGES.twin,
      imageAlt: "Twin — a fast shared-symbol card game from Milk & Henny",
    }),
});
