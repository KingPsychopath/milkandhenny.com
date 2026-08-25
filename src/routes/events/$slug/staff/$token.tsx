import { createFileRoute } from "@tanstack/react-router";

import { getStaffScoringPageFn } from "@/features/event-scoring/staff-scoring.functions";
import { StaffScoringPage } from "@/features/event-scoring/ui/StaffScoringPage";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug/staff/$token")({
  loader: ({ params }) =>
    getStaffScoringPageFn({ data: { eventSlug: params.slug, token: params.token } }),
  component: StaffScoringRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Staff scoring",
      description: "A private event scoring station.",
      path: `/events/${params.slug}/staff/${params.token}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function StaffScoringRoute() {
  const data = Route.useLoaderData();
  const { token } = Route.useParams();
  if (!data.found) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">staff scoring</p>
        <h1 className="mt-2 font-serif text-3xl">This link is not active</h1>
        <p className="mt-4 font-mono text-xs theme-muted">Ask the organiser for a new link.</p>
      </main>
    );
  }
  return <StaffScoringPage data={data} token={token} />;
}
