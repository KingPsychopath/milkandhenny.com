import { createFileRoute } from "@tanstack/react-router";
import { RemoteJudgeApp } from "@/features/things/remote/RemoteJudgeApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/judge/$roomId")({
  component: JudgeRoute,
  head: () => ({
    meta: [
      { title: `Remote judge — ${SITE_NAME}` },
      { name: "description", content: "Control a shared game round from your phone." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function JudgeRoute() {
  const { roomId } = Route.useParams();
  return <RemoteJudgeApp roomId={roomId.toUpperCase()} />;
}
