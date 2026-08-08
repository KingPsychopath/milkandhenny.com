import { createFileRoute } from "@tanstack/react-router";
import { CentreRoomApp } from "@/features/things/centre/CentreRoomApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/centre_/$roomId")({
  component: CentreRoomRoute,
  head: () => ({
    meta: [
      { title: `Centre room — ${SITE_NAME}` },
      { name: "description", content: "Join a shared circular maze race." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function CentreRoomRoute() {
  const { roomId } = Route.useParams();
  return <CentreRoomApp roomId={roomId.toUpperCase()} />;
}
