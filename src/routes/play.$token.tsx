import { createFileRoute } from "@tanstack/react-router";
import { GamePoolEntranceApp } from "@/features/things/pool/GamePoolEntranceApp";
import { getGamePoolPublicViewFn } from "@/features/things/pool/pool.functions";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/play/$token")({
  loader: ({ params }) => getGamePoolPublicViewFn({ data: { token: params.token } }),
  component: GamePoolEntranceRoute,
  head: () => ({
    meta: [
      { title: `game night · ${SITE_NAME}` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function GamePoolEntranceRoute() {
  const view = Route.useLoaderData();
  const { token } = Route.useParams();
  return <GamePoolEntranceApp token={token} initialView={view} />;
}
