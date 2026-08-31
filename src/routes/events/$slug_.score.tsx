import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { getPublicLeaderboardFn } from "@/features/event-scoring/public.functions";
import { TeamBadge } from "@/features/event-scoring/ui/TeamBadge";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/score")({
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
  const { slug } = Route.useParams();
  const currentAttendee = data.rows.find((row) => row.isCurrentAttendee);
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <Link
        to="/events/$slug"
        params={{ slug }}
        className="font-mono text-xs underline hover:opacity-70"
      >
        ← event
      </Link>
      <header className="mt-10">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">event score</p>
        <h1 className="mt-2 font-serif text-4xl text-foreground">Leaderboard</h1>
        <p className="mt-3 font-mono text-xs theme-subtle">{formatState(data.boardStatus)}</p>
      </header>
      {data.teams.length > 1 ? (
        <section className="mt-10" aria-labelledby="team-standings-heading">
          <h2
            id="team-standings-heading"
            className="font-mono text-micro uppercase tracking-widest theme-muted"
          >
            team standings
          </h2>
          <ol className="mt-3 divide-y border-y theme-border">
            {data.teams.map((team) => (
              <li key={team.id} className="flex min-h-14 items-center gap-4 py-3">
                <span className="w-7 shrink-0 font-mono text-sm theme-muted">{team.rank}</span>
                <TeamBadge
                  name={team.name}
                  colourKey={team.colourKey}
                  className="min-w-0 flex-1 text-xs"
                />
                <span className="font-mono text-sm">{team.points}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {data.rows.length === 0 ? (
        <p className="mt-12 border-y theme-border py-6 font-serif text-lg theme-subtle">
          The leaderboard is not public yet.
        </p>
      ) : (
        <section className="mt-10" aria-labelledby="individual-standings-heading">
          <h2
            id="individual-standings-heading"
            className="font-mono text-micro uppercase tracking-widest theme-muted"
          >
            individual standings
          </h2>
          {currentAttendee && currentAttendee.rank > 5 ? (
            <div className="mt-3 border-y theme-border py-4" aria-label="Your current place">
              <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                your place
              </p>
              <div className="mt-2 flex items-baseline gap-4 font-semibold">
                <span className="w-8 shrink-0 font-mono text-sm theme-muted">
                  {currentAttendee.rank}
                </span>
                <span className="min-w-0 flex-1 font-serif text-lg text-foreground">
                  {currentAttendee.publicAlias}
                </span>
                {currentAttendee.team ? (
                  <TeamBadge
                    name={currentAttendee.team}
                    colourKey={currentAttendee.teamColourKey}
                  />
                ) : null}
                <span className="font-mono text-sm text-foreground">{currentAttendee.points}</span>
              </div>
            </div>
          ) : null}
          <ol className="mt-3 divide-y theme-border border-y theme-border">
            {data.rows.map((row, index) => (
              <li
                key={`${row.rank}-${row.publicAlias}-${index}`}
                className={`flex items-baseline gap-4 py-4 ${row.isCurrentAttendee ? "font-semibold" : ""}`}
              >
                <span className="w-8 shrink-0 font-mono text-sm theme-muted">{row.rank}</span>
                <span className="min-w-0 flex-1 font-serif text-lg text-foreground">
                  {row.publicAlias}
                  {row.isCurrentAttendee && (
                    <span className="ml-2 font-mono text-micro theme-muted">you</span>
                  )}
                </span>
                {row.team ? <TeamBadge name={row.team} colourKey={row.teamColourKey} /> : null}
                <span className="font-mono text-sm text-foreground">{row.points}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

function formatState(status: string): string {
  if (status === "final") return "final board";
  if (status === "corrected-provisional") return "corrected; prize results need final review";
  if (status === "frozen") return "frozen while results are checked";
  if (status === "closed") return "closed; results are not final";
  return "live board";
}
