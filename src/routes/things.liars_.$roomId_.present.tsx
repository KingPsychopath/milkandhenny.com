import { createFileRoute } from "@tanstack/react-router";
import { LiarsPresenterApp } from "@/features/things/liars/LiarsPresenterApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/liars_/$roomId_/present")({
  component: LiarsPresenterRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Liars — big screen — ${SITE_NAME}`,
      description: "Present a private Liars game on the big screen.",
      path: `/things/liars/${params.roomId}/present`,
      image: OG_IMAGES.liars,
      robots: "noindex, nofollow",
    }),
});

function LiarsPresenterRoute() {
  return <LiarsPresenterApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
