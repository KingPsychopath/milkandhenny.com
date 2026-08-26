import { createFileRoute } from "@tanstack/react-router";

import { GamePoolOperatorApp } from "@/features/things/pool/GamePoolOperatorApp";
import { getGamePoolOperatorViewFn } from "@/features/things/pool/operator.functions";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/organize/$token")({
  loader: {
    handler: ({ params }) => getGamePoolOperatorViewFn({ data: { token: params.token } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: OperatorRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Game night organiser — Milk & Henny",
      description: "A private Milk & Henny game night control page.",
      path: `/organize/${params.token}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function OperatorRoute() {
  const { token } = Route.useParams();
  return <GamePoolOperatorApp token={token} initialView={Route.useLoaderData()} />;
}
