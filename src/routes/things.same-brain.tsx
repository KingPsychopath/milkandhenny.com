import { createFileRoute } from "@tanstack/react-router";
import { SameBrainSetupApp } from "@/features/things/same-brain/SameBrainSetupApp";
import { getDefaultGamePoolLaunchFn } from "@/features/things/pool/pool.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/same-brain")({
  loader: () => getDefaultGamePoolLaunchFn({ data: { game: "same-brain" } }).catch(() => null),
  component: SameBrainSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Same Brain — ${SITE_NAME}`,
      description: "Answer like everyone else and score together. For 3 to 16 people.",
      path: "/things/same-brain",
      image: OG_IMAGES.sameBrain,
      imageAlt: "Same Brain — answer like everyone else in a party game",
    }),
});

function SameBrainSetupRoute() {
  return <SameBrainSetupApp defaultPool={Route.useLoaderData()} />;
}
