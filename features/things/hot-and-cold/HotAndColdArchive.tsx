import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { recoverDailyHotAndColdState } from "./hot-and-cold-daily-recovery";
import type { HotAndColdCommunityStats } from "./types";

export interface HotAndColdArchiveEntry {
  puzzle: number;
  date: string;
  judgingVersion: string;
  community: HotAndColdCommunityStats | null;
}

const ZONES = ["frost", "cool", "warm", "hot"] as const;
type VisibleCommunityStats = Extract<HotAndColdCommunityStats, { visible: true }>;

function CommunityBars({ stats }: { stats: VisibleCommunityStats }) {
  const largest = Math.max(...Object.values(stats.distribution), 1);
  return (
    <span className="heat-share-dock-bars" aria-hidden="true">
      {ZONES.map((zone) => (
        <span
          key={zone}
          className="heat-share-dock-bar"
          data-zone={zone}
          style={{ "--heat-share-intensity": stats.distribution[zone] / largest } as CSSProperties}
        >
          <i />
        </span>
      ))}
    </span>
  );
}

export function HotAndColdArchive({ history }: { history: HotAndColdArchiveEntry[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  useEffect(() => {
    const recovered: Record<number, string> = {};
    for (const { judgingVersion, puzzle } of history) {
      const saved = recoverDailyHotAndColdState(localStorage, puzzle, judgingVersion);
      if (saved?.state.target) recovered[puzzle] = saved.state.target;
    }
    setAnswers(recovered);
  }, [history]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    [],
  );

  if (!history.length) return null;
  return (
    <section className="mt-12 border-t theme-border pt-7" aria-labelledby="past-words">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="font-mono text-micro uppercase tracking-[.16em] theme-muted">the archive</p>
          <h2 id="past-words" className="mt-2 font-serif text-3xl font-semibold">
            Previous words
          </h2>
        </div>
        <p className="font-mono text-micro theme-muted">midnight Europe/London</p>
      </div>
      <p className="mt-3 max-w-md font-serif text-sm leading-relaxed theme-muted">
        Open a day to see how the community fared, then play it without revealing the answer.
      </p>
      <ol className="mt-5 divide-y border-y theme-border">
        {history.map((entry) => {
          const open = expanded === entry.puzzle;
          const stats = entry.community?.visible ? entry.community : null;
          const panelId = `hot-and-cold-archive-${entry.puzzle}`;
          return (
            <li key={entry.puzzle}>
              <button
                type="button"
                className="grid min-h-16 w-full grid-cols-[1fr_auto_auto] items-center gap-5 py-3 text-left transition-opacity hover:opacity-70"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setExpanded(open ? null : entry.puzzle)}
              >
                <span>
                  <span className="block font-mono text-xs">daily #{entry.puzzle}</span>
                  <time
                    dateTime={entry.date}
                    className="mt-1 block font-mono text-micro theme-muted"
                  >
                    {dateFormatter.format(new Date(`${entry.date}T12:00:00Z`))}
                  </time>
                </span>
                <span className="flex items-center gap-3">
                  {stats ? <CommunityBars stats={stats} /> : null}
                  <span className="font-mono text-micro theme-muted">
                    {answers[entry.puzzle]
                      ? "played"
                      : stats
                        ? `${stats.runs} runs`
                        : "past puzzle"}
                  </span>
                </span>
                <span aria-hidden="true" className="font-mono text-sm theme-muted">
                  {open ? "−" : "+"}
                </span>
              </button>
              {open ? (
                <div id={panelId} className="border-t theme-border pb-5 pt-4">
                  {stats ? (
                    <dl className="grid grid-cols-2 gap-4 font-mono text-micro theme-muted">
                      <div>
                        <dt>median solve</dt>
                        <dd className="mt-1 font-serif text-xl text-[var(--foreground)]">
                          {stats.medianGuesses === null
                            ? "—"
                            : `${stats.medianGuesses.toLocaleString("en-GB", {
                                maximumFractionDigits: 1,
                              })} guesses`}
                        </dd>
                      </div>
                      <div>
                        <dt>found it</dt>
                        <dd className="mt-1 font-serif text-xl text-[var(--foreground)]">
                          {Math.round(stats.solveRate * 100)}%
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  {answers[entry.puzzle] ? (
                    <p className="mt-4 font-mono text-xs theme-muted">
                      your revealed word ·{" "}
                      <strong className="font-serif text-lg text-[var(--foreground)]">
                        {answers[entry.puzzle]}
                      </strong>
                    </p>
                  ) : null}
                  <Link
                    to="/things/hot-and-cold/daily/$puzzle"
                    params={{ puzzle: String(entry.puzzle) }}
                    className="mh-action mh-action--secondary mt-5 w-full"
                  >
                    {answers[entry.puzzle] ? "revisit this puzzle" : `play daily #${entry.puzzle}`}
                  </Link>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
