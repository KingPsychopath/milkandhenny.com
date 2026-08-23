import { createFileRoute } from "@tanstack/react-router";

import { PresentationHost } from "@/features/things/pitches/ui/PresentationHost";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/present_/$roomId")({
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
  return <PresentationHost roomId={Route.useParams().roomId} />;
}
