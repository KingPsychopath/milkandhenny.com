import { createFileRoute } from "@tanstack/react-router";

import { ScoringRetiredPage } from "@/features/event-scoring/ui/ScoringRetiredPage";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/game-result-claim")({
  component: () => <ScoringRetiredPage eventSlug={Route.useParams().slug} />,
  head: ({ params }) =>
    buildSeoHead({
      title: "Event games",
      description: "This event points link has finished.",
      path: `/events/${params.slug}/game-result-claim`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});
