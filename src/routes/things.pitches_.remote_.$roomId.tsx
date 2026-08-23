import { createFileRoute } from "@tanstack/react-router";

import { PresentationRemote } from "@/features/things/pitches/ui/PresentationRemote";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { readPitchOperationalStatusFn } from "@/features/things/pitches/pitches.functions";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/remote_/$roomId")({
  loader: () => readPitchOperationalStatusFn(),
  component: RemoteRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Pitch remote — Milk & Henny",
      description: "Control a private Milk & Henny pitch presentation.",
      path: `/things/pitches/remote/${params.roomId}`,
      robots: "noindex, nofollow",
    }),
});

function RemoteRoute() {
  const status = Route.useLoaderData();
  return status.canPresent ? (
    <PresentationRemote roomId={Route.useParams().roomId} />
  ) : (
    <PitchOperationalNotice status={status} />
  );
}
