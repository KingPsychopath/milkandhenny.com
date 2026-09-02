import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { forgetStaffAccess, rememberStaffAccess } from "@/features/event-operations/staff-memory";
import { getStaffScoringPageFn } from "@/features/event-scoring/staff-scoring.functions";
import { StaffScoringPage } from "@/features/event-scoring/ui/StaffScoringPage";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/staff/$token")({
  loader: {
    handler: ({ params }) =>
      getStaffScoringPageFn({ data: { eventSlug: params.slug, token: params.token } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
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
  const { slug, token } = Route.useParams();
  useEffect(() => {
    if (!data.found) {
      forgetStaffAccess(slug, token);
      return;
    }
    rememberStaffAccess({
      eventSlug: data.eventSlug,
      eventTitle: data.eventTitle,
      token,
      label: data.label,
      rolePreset: data.rolePreset,
      assignmentType: data.assignmentType,
      expiresAt: data.expiresAt,
    });
  }, [data, slug, token]);
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
