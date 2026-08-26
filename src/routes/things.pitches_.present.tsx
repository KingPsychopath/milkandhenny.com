import { createFileRoute } from "@tanstack/react-router";
import { getPresentationAccessFn } from "@/features/things/pitches/presentation.functions";
import { PresentationSetup } from "@/features/things/pitches/ui/PresentationSetup";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/present")({
  loader: () => getPresentationAccessFn(),
  component: PresentationSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Present pitches — ${SITE_NAME}`,
      description: "Choose a private pitch and present it on the big screen.",
      path: "/things/pitches/present",
      image: OG_IMAGES.pitchStudio,
      robots: "noindex, nofollow",
    }),
});

function PresentationSetupRoute() {
  const data = Route.useLoaderData();
  return data.operationalStatus.canPresent ? (
    <PresentationSetup authorised={data.auth.ok} />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
