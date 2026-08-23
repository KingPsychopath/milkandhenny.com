import { createFileRoute } from "@tanstack/react-router";
import { LiarsSetupApp } from "@/features/things/liars/LiarsSetupApp";
import { getDefaultGamePoolLaunchFn } from "@/features/things/pool/pool.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/liars")({
  loader: () => getDefaultGamePoolLaunchFn({ data: { game: "liars" } }).catch(() => null),
  component: LiarsSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Liars: Mafia and Imposter — ${SITE_NAME}`,
      description:
        "Mafia or imposter for 4 to 16 phones. Everyone acts every night, and nobody keeps score.",
      path: "/things/liars",
      image: OG_IMAGES.liars,
      imageAlt: "Liars — Mafia and Imposter social deduction games from Milk & Henny",
    }),
});

function LiarsSetupRoute() {
  return <LiarsSetupApp defaultPool={Route.useLoaderData()} />;
}
