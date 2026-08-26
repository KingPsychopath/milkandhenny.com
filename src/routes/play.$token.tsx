import { createFileRoute } from "@tanstack/react-router";
import { GamePoolEntranceApp } from "@/features/things/pool/GamePoolEntranceApp";
import { getGamePoolPublicViewFn } from "@/features/things/pool/pool.functions";
import { MULTIPLAYER_ROOM_ID_PATTERN } from "@/features/things/shared/multiplayer";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/play/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    choose: search.choose === true || search.choose === "1",
    room:
      typeof search.room === "string" && MULTIPLAYER_ROOM_ID_PATTERN.test(search.room.toUpperCase())
        ? search.room.toUpperCase()
        : undefined,
  }),
  loader: {
    handler: ({ params }) => getGamePoolPublicViewFn({ data: { token: params.token } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: GamePoolEntranceRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Game night · ${SITE_NAME}`,
      description: "Join a private Milk & Henny game night.",
      path: `/play/${params.token}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function GamePoolEntranceRoute() {
  const view = Route.useLoaderData();
  const { token } = Route.useParams();
  const { choose, room } = Route.useSearch();
  return (
    <GamePoolEntranceApp
      token={token}
      initialView={view}
      requestedRoomId={room}
      suppressAutoJoin={choose}
    />
  );
}
