import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getPublicLeaderboardFn } from "@/features/event-scoring/public.functions";
import type { PublicLeaderboardRow } from "@/features/event-scoring/types";
import { TeamBadge } from "@/features/event-scoring/ui/TeamBadge";
import { buildSeoHead } from "@/lib/shared/seo";

const LEADERBOARD_PAGE_SIZE = 20;

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
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(LEADERBOARD_PAGE_SIZE);
  const currentAttendee = data.rows.find((row) => row.isCurrentAttendee);
  const filteredRows = useMemo(() => {
    const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return data.rows;
    return data.rows.filter((row) => {
      const searchable =
        `${row.publicAlias} ${row.entryCode} ${row.team ?? ""}`.toLocaleLowerCase();
      return tokens.every((token) => searchable.includes(token));
    });
  }, [data.rows, query]);
  const visibleRows = filteredRows.slice(0, visibleCount);
  const currentAttendeeIsVisible = visibleRows.some((row) => row.isCurrentAttendee);
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
          <div className="relative mt-4">
            <label htmlFor="leaderboard-search" className="sr-only">
              Find a person or team
            </label>
            <input
              id="leaderboard-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(LEADERBOARD_PAGE_SIZE);
              }}
              placeholder="find a person or team"
              autoComplete="off"
              aria-describedby={query ? "leaderboard-search-count" : undefined}
              className="search-input w-full border-b theme-border bg-transparent py-3 pr-12 font-mono text-base theme-muted transition-colors placeholder:theme-faint sm:text-sm"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setVisibleCount(LEADERBOARD_PAGE_SIZE);
                }}
                aria-label="Clear leaderboard search"
                className="absolute inset-y-0 right-0 flex min-h-11 w-11 min-w-11 items-center justify-center font-mono theme-faint transition-colors hover:text-foreground"
              >
                ×
              </button>
            ) : null}
          </div>
          {query ? (
            <p
              id="leaderboard-search-count"
              aria-live="polite"
              className="mt-1.5 font-mono text-micro theme-faint"
            >
              {filteredRows.length === 0
                ? "no matches"
                : `${filteredRows.length} result${filteredRows.length === 1 ? "" : "s"}`}
            </p>
          ) : null}
          {currentAttendee && !query && !currentAttendeeIsVisible ? (
            <div className="mt-3 border-y theme-border py-4" aria-label="Your current place">
              <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                your place
              </p>
              <LeaderboardEntry row={currentAttendee} />
            </div>
          ) : null}
          {visibleRows.length > 0 ? (
            <ol className="mt-3 divide-y theme-border border-y theme-border">
              {visibleRows.map((row, index) => (
                <li key={`${row.entryCode}-${index}`}>
                  <LeaderboardEntry row={row} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-8 border-y theme-border py-6 font-serif text-lg theme-subtle">
              No people or teams match that search.
            </p>
          )}
          {filteredRows.length > visibleCount ? (
            <button
              type="button"
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(count + LEADERBOARD_PAGE_SIZE, filteredRows.length),
                )
              }
              className="mt-5 inline-flex min-h-11 items-center font-mono text-xs underline hover:opacity-70"
            >
              show next {Math.min(LEADERBOARD_PAGE_SIZE, filteredRows.length - visibleCount)}
            </button>
          ) : null}
        </section>
      )}
    </main>
  );
}

function LeaderboardEntry({ row }: { row: PublicLeaderboardRow }) {
  return (
    <details className={row.isCurrentAttendee ? "font-semibold" : undefined}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-4 hover:opacity-70">
        <span className="w-8 shrink-0 font-mono text-sm theme-muted">{row.rank}</span>
        <span className="min-w-0 flex-1 font-serif text-lg text-foreground">
          {row.publicAlias}
          {row.isCurrentAttendee ? (
            <span className="ml-2 font-mono text-micro theme-muted">you</span>
          ) : null}
          <span className="ml-2 whitespace-nowrap font-mono text-micro font-normal theme-muted">
            player {row.entryCode}
          </span>
        </span>
        {row.team ? <TeamBadge name={row.team} colourKey={row.teamColourKey} /> : null}
        <span className="font-mono text-sm text-foreground">{row.points}</span>
        <span aria-hidden="true" className="font-mono text-xs theme-muted">
          +
        </span>
      </summary>
      <div className="mb-4 ml-12 border-l theme-border pl-4">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          point breakdown
        </p>
        {row.breakdown.length > 0 ? (
          <dl className="mt-2 space-y-2">
            {row.breakdown.map((entry) => (
              <div key={entry.label} className="flex items-baseline justify-between gap-4">
                <dt className="font-mono text-xs">{entry.label}</dt>
                <dd className="font-mono text-xs">
                  {entry.points > 0 ? "+" : ""}
                  {entry.points}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 font-mono text-xs theme-muted">No awarded points yet.</p>
        )}
      </div>
    </details>
  );
}

function formatState(status: string): string {
  if (status === "final") return "final board";
  if (status === "corrected-provisional") return "corrected; prize results need final review";
  if (status === "frozen") return "frozen while results are checked";
  if (status === "closed") return "closed; results are not final";
  return "live board";
}
