import { createFileRoute } from "@tanstack/react-router";

import { PresentationRemote } from "@/features/things/pitches/ui/PresentationRemote";

export const Route = createFileRoute("/things/pitches_/remote_/$roomId")({
  component: RemoteRoute,
});

function RemoteRoute() {
  return <PresentationRemote roomId={Route.useParams().roomId} />;
}
