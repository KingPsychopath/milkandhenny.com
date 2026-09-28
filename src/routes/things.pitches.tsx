import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { pitchWallQuery } from "@/features/things/pitches/pitches.queries";
import { PitchGallery } from "@/features/things/pitches/ui/PitchGallery";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches")({
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(pitchWallQuery());
  },
  preloadStaleTime: 0,
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
  const { data } = useSuspenseQuery(pitchWallQuery());
  return data.operationalStatus.canRead ? (
    <PitchGallery />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
