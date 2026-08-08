import { createFileRoute } from "@tanstack/react-router";
import { SameBrainRoomApp } from "@/features/things/same-brain/SameBrainRoomApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/same-brain_/$roomId")({
  component: SameBrainRoomRoute,
  head: () => ({ meta: [{ title: `Join Same Brain — ${SITE_NAME}` }] }),
});

function SameBrainRoomRoute() {
  return <SameBrainRoomApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
