import { createFileRoute } from "@tanstack/react-router";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { NewPitch } from "@/features/things/pitches/ui/NewPitch";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/new")({
  loader: () => listPublishedPitchesFn(),
  component: NewPitchRoute,
  head: () =>
    buildSeoHead({
      title: `New pitch — ${SITE_NAME}`,
      description: "Start a new six-slide pitch in the Milk & Henny studio.",
      path: "/things/pitches/new",
      image: OG_IMAGES.pitchStudio,
      robots: "noindex, nofollow",
    }),
});

function NewPitchRoute() {
  const data = Route.useLoaderData();
  return data.operationalStatus.canRead ? (
    <NewPitch
      maximumSlides={data.maximumSlides}
      operationalStatus={data.operationalStatus}
      creatorIdentity={data.creatorIdentity}
      emailDestination={data.emailDestination}
    />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
