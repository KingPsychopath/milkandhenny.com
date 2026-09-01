import { createFileRoute } from "@tanstack/react-router";

import { GroupGameClaimApp } from "@/features/event-scoring/ui/GroupGameClaimApp";
import { getDiscoveryClaimPageFn } from "@/features/event-scoring/public.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/game-result-claim")({
  loader: ({ params }) => getDiscoveryClaimPageFn({ data: { eventSlug: params.slug } }),
  component: GroupGameClaimRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Claim game points — ${SITE_NAME}`,
      description: "Claim points from a completed event game.",
      path: `/events/${params.slug}/game-result-claim`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function GroupGameClaimRoute() {
  const { activeParticipantId, tickets } = Route.useLoaderData();
  return (
    <GroupGameClaimApp
      eventSlug={Route.useParams().slug}
      activeParticipantId={activeParticipantId}
      tickets={tickets}
    />
  );
}
