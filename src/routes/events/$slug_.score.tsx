import { Link, createFileRoute } from "@tanstack/react-router";

import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/score")({
  component: RetiredScoreRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Event scores retired",
      description: "This event no longer uses a public points board.",
      path: `/events/${params.slug}/score`,
      robots: "noindex, nofollow",
    }),
});

function RetiredScoreRoute() {
  const { slug } = Route.useParams();
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <div>
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">event</p>
        <h1 className="mt-3 font-serif text-4xl">Points have finished.</h1>
        <p className="mt-4 font-serif text-lg leading-relaxed theme-subtle">
          This event no longer uses a public points board. Games and your event ticket still work
          normally.
        </p>
        <Link to="/events/$slug" params={{ slug }} className="mh-action mh-action--primary mt-8">
          return to event
        </Link>
      </div>
    </main>
  );
}
