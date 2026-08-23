import { createFileRoute } from "@tanstack/react-router";

import { PresentationHost } from "@/features/things/pitches/ui/PresentationHost";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { readPitchOperationalStatusFn } from "@/features/things/pitches/pitches.functions";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/present_/$roomId")({
  loader: () => readPitchOperationalStatusFn(),
  component: HostRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Pitch presentation — Milk & Henny",
      description: "A private Milk & Henny pitch presentation.",
      path: `/things/pitches/present/${params.roomId}`,
      robots: "noindex, nofollow",
    }),
});

function HostRoute() {
  const status = Route.useLoaderData();
  return status.canPresent ? (
    <PresentationHost roomId={Route.useParams().roomId} />
  ) : (
    <PitchOperationalNotice status={status} />
  );
}
