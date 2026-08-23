import { createFileRoute } from "@tanstack/react-router";

import { GamePoolOperatorApp } from "@/features/things/pool/GamePoolOperatorApp";
import { getGamePoolOperatorViewFn } from "@/features/things/pool/operator.functions";

export const Route = createFileRoute("/organize/$token")({
  loader: ({ params }) => getGamePoolOperatorViewFn({ data: { token: params.token } }),
  component: OperatorRoute,
});

function OperatorRoute() {
  const { token } = Route.useParams();
  return <GamePoolOperatorApp token={token} initialView={Route.useLoaderData()} />;
}
