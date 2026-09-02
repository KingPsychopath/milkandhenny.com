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
      description: "Put one strong idea—or a full pitch—on the big screen.",
      path: "/things/pitches",
      image: OG_IMAGES.pitchStudio,
      imageAlt: "Pitch Night Studio — put an idea on the big screen",
    }),
});

function PitchGalleryRoute() {
  const data = Route.useLoaderData();
  return data.operationalStatus.canRead ? (
    <PitchGallery
      initialWall={data.wall}
      operationalStatus={data.operationalStatus}
      personalPitches={data.personalPitches}
    />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
