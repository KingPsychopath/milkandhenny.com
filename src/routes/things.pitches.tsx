import { createFileRoute } from "@tanstack/react-router";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { PitchGallery } from "@/features/things/pitches/ui/PitchGallery";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches")({
  loader: () => listPublishedPitchesFn(),
  component: PitchGalleryRoute,
  head: () =>
    buildSeoHead({
      title: `Pitch Night Studio — ${SITE_NAME}`,
      description: "Make six slides, seal the idea, and take over the big screen.",
      path: "/things/pitches",
      image: OG_IMAGES.pitchStudio,
      imageAlt: "Pitch Night Studio — make six slides and present them on the big screen",
    }),
});

function PitchGalleryRoute() {
  const data = Route.useLoaderData();
  return data.operationalStatus.canRead ? (
    <PitchGallery initialPitches={data.pitches} operationalStatus={data.operationalStatus} />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
