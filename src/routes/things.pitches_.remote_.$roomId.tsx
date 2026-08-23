import { createFileRoute } from "@tanstack/react-router";

import { PresentationRemote } from "@/features/things/pitches/ui/PresentationRemote";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/remote_/$roomId")({
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
  return <PresentationRemote roomId={Route.useParams().roomId} />;
}
