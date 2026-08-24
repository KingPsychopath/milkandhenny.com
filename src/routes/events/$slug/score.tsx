import { createFileRoute, notFound } from "@tanstack/react-router";

import { getPublicLeaderboardFn } from "@/features/event-scoring/public.functions";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug/score")({
  loader: async ({ params }) => {
    const result = await getPublicLeaderboardFn({ data: { eventSlug: params.slug } });
    if (!result.ok) throw notFound();
    return result.value;
  },
  component: ScoreRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Event leaderboard",
      description: "A public event score board.",
      path: `/events/${params.slug}/score`,
      robots: "noindex, nofollow",
    }),
});

function ScoreRoute() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <a
        href={`/events/${encodeURIComponent(Route.useParams().slug)}`}
        className="font-mono text-xs underline hover:opacity-70"
      >
        ← event
      </a>
      <header className="mt-10">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">event score</p>
        <h1 className="mt-2 font-serif text-4xl text-foreground">Leaderboard</h1>
        <p className="mt-3 font-mono text-xs theme-subtle">
          {formatState(data.state, data.visibility)}
        </p>
      </header>
      {data.rows.length === 0 ? (
        <p className="mt-12 border-y theme-border py-6 font-serif text-lg theme-subtle">
          The leaderboard is not public yet.
        </p>
      ) : (
        <ol className="mt-10 divide-y theme-border border-y theme-border">
          {data.rows.map((row) => (
            <li
              key={`${row.rank}-${row.publicAlias}`}
              className={`flex items-baseline gap-4 py-4 ${row.isCurrentAttendee ? "font-semibold" : ""}`}
            >
              <span className="w-8 shrink-0 font-mono text-sm theme-muted">{row.rank}</span>
              <span className="min-w-0 flex-1 font-serif text-lg text-foreground">
                {row.publicAlias}
                {row.isCurrentAttendee && (
                  <span className="ml-2 font-mono text-micro theme-muted">you</span>
                )}
              </span>
              {row.team && <span className="font-mono text-micro theme-muted">{row.team}</span>}
              <span className="font-mono text-sm text-foreground">{row.points}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function formatState(state: string, visibility: string): string {
  if (visibility === "public-final") return "final board";
  if (state === "frozen") return "frozen while results are checked";
  if (state === "closed") return "closed";
  return "live board";
}
