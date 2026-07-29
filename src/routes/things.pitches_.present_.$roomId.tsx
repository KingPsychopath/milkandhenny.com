import { createFileRoute } from "@tanstack/react-router";

import { PresentationHost } from "@/features/things/pitches/ui/PresentationHost";

export const Route = createFileRoute("/things/pitches_/present_/$roomId")({
  component: HostRoute,
});

function HostRoute() {
  return <PresentationHost roomId={Route.useParams().roomId} />;
}
