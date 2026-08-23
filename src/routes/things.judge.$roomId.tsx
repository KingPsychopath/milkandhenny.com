import { createFileRoute } from "@tanstack/react-router";
import { RemoteJudgeApp } from "@/features/things/remote/RemoteJudgeApp";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/judge/$roomId")({
  component: JudgeRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Remote judge — ${SITE_NAME}`,
      description: "Control a shared game round from your phone.",
      path: `/things/judge/${params.roomId}`,
      robots: "noindex, nofollow",
    }),
});

function JudgeRoute() {
  const { roomId } = Route.useParams();
  return <RemoteJudgeApp roomId={roomId.toUpperCase()} />;
}
