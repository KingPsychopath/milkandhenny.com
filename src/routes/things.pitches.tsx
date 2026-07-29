import { createFileRoute } from "@tanstack/react-router";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { PitchGallery } from "@/features/things/pitches/ui/PitchGallery";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/pitches")({
  loader: () => listPublishedPitchesFn(),
  component: PitchGalleryRoute,
  head: () => ({
    meta: [
      { title: `Pitch Night Studio — ${SITE_NAME}` },
      {
        name: "description",
        content: "Make, publish and present a six-slide pitch.",
      },
    ],
  }),
});

function PitchGalleryRoute() {
  const data = Route.useLoaderData();
  return <PitchGallery initialPitches={data.pitches} />;
}
