import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSelect } from "@/components/AppSelect";
import type {
  HotAndColdQualityReport,
  HotAndColdUpcomingReview,
} from "@/features/things/hot-and-cold/hot-and-cold-review";
import { AdminStatus } from "./AdminStatus";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

function signedRank(value: number) {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

function ReviewDetail({ review }: { review: HotAndColdUpcomingReview }) {
  const failedComparisons = review.comparisons.filter(({ passes }) => !passes);
  return (
    <div className="space-y-8 border-t theme-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            daily #{review.puzzle} · {review.date}
          </p>
          <h4 className="mt-1 font-serif text-2xl font-semibold">{review.target}</h4>
        </div>
        <AdminStatus
          tone={review.approved ? "positive" : "attention"}
          className="font-mono text-xs"
        >
          {review.approved ? "approved trail" : "approval required"}
        </AdminStatus>
      </div>

      <section aria-labelledby="hot-cold-hints-heading">
        <h5
          id="hot-cold-hints-heading"
          className="font-mono text-micro font-bold uppercase tracking-widest theme-muted"
        >
          official hints · cooler to hotter
        </h5>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {review.hints.map((hint, index) => (
            <li key={hint} className="border-b theme-border pb-2 font-mono text-sm">
              <span className="mr-2 theme-muted">{index + 1}</span>
              {hint}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="hot-cold-comparisons-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h5
            id="hot-cold-comparisons-heading"
            className="font-mono text-micro font-bold uppercase tracking-widest theme-muted"
          >
            expected comparisons
          </h5>
          <AdminStatus
            tone={failedComparisons.length === 0 ? "positive" : "danger"}
            className="font-mono text-xs"
          >
            {failedComparisons.length === 0
              ? "all comparisons pass"
              : `${failedComparisons.length} failed`}
          </AdminStatus>
        </div>
        {review.comparisons.length > 0 ? (
          <ul className="mt-3 divide-y theme-border border-y theme-border">
            {review.comparisons.map((comparison) => (
              <li
                key={`${comparison.closer}:${comparison.farther}`}
                className="grid gap-1 py-3 font-mono text-xs sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center"
              >
                <span>{comparison.closer}</span>
                <span className="theme-muted">#{comparison.closerRank.toLocaleString()}</span>
                <span className="sm:pl-6">{comparison.farther}</span>
                <span className="theme-muted">#{comparison.fartherRank.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 font-mono text-xs theme-muted">No comparison fixture is recorded.</p>
        )}
      </section>

      <section aria-labelledby="hot-cold-top-heading">
        <h5
          id="hot-cold-top-heading"
          className="font-mono text-micro font-bold uppercase tracking-widest theme-muted"
        >
          top 30 words
        </h5>
        <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {review.top.map(({ rank, word }) => (
            <li key={word} className="flex gap-2 border-b theme-border pb-1 font-mono text-xs">
              <span className="w-8 shrink-0 text-right theme-muted">#{rank}</span>
              <span className="min-w-0 truncate">{word}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="hot-cold-suspicious-heading">
          <h5
            id="hot-cold-suspicious-heading"
            className="font-mono text-micro font-bold uppercase tracking-widest theme-muted"
          >
            suspicious top words
          </h5>
          {review.suspicious.length > 0 ? (
            <ul className="mt-3 space-y-2 font-mono text-xs">
              {review.suspicious.map(({ rank, reasons, word }) => (
                <li key={word} className="flex justify-between gap-3 border-b theme-border pb-2">
                  <span>
                    #{rank} {word}
                  </span>
                  <span className="text-right theme-muted">{reasons.join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 font-mono text-xs theme-muted">No rare or polysemous top words.</p>
          )}
        </section>

        <section aria-labelledby="hot-cold-changes-heading">
          <h5
            id="hot-cold-changes-heading"
            className="font-mono text-micro font-bold uppercase tracking-widest theme-muted"
          >
            biggest changes from 1.0.0
          </h5>
          <ul className="mt-3 space-y-2 font-mono text-xs">
            {review.changes.slice(0, 10).map(({ change, previousRank, rank, word }) => (
              <li key={word} className="grid grid-cols-[1fr_auto] gap-3 border-b theme-border pb-2">
                <span>{word}</span>
                <span className="text-right theme-muted">
                  #{previousRank.toLocaleString()} → #{rank.toLocaleString()} ({signedRank(change)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function HotAndColdReviewPanel({
  authFetch,
  onError,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
}) {
  const [report, setReport] = useState<HotAndColdQualityReport | null>(null);
  const [selectedPuzzle, setSelectedPuzzle] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/hot-and-cold-review");
      if (!response.ok) throw new Error("Could not load judging quality evidence");
      const next = (await response.json()) as HotAndColdQualityReport;
      setReport(next);
      setSelectedPuzzle((current) => current ?? next.upcoming[0]?.puzzle ?? null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load judging quality evidence");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => report?.upcoming.find(({ puzzle }) => puzzle === selectedPuzzle) ?? report?.upcoming[0],
    [report, selectedPuzzle],
  );

  return (
    <section aria-labelledby="hot-cold-quality-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b theme-border pb-5">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            semantic judging
          </p>
          <h3 id="hot-cold-quality-heading" className="mt-1 font-serif text-2xl font-semibold">
            Hot and Cold quality window
          </h3>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
            Generated evidence for the next 30 unplayed puzzles. Approval is tied to each exact
            top-30 trail and hint set; regeneration invalidates its hash.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          {loading ? "loading…" : "refresh evidence"}
        </button>
      </div>

      {report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="font-mono text-xs theme-muted">
              upcoming puzzle
              <AppSelect
                value={selectedPuzzle ?? ""}
                onValueChange={(value) => setSelectedPuzzle(Number(value))}
                options={report.upcoming.map(({ approved, date, puzzle, target }) => ({
                  value: puzzle,
                  label: `#${puzzle} · ${date} · ${target}${approved ? " · approved" : " · review"}`,
                }))}
                tone="theme"
                variant="field"
                ariaLabel="Upcoming Hot and Cold puzzle"
                className="mt-2"
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-2 font-mono text-xs theme-muted">
              <span>{report.judgingVersion}</span>
              <span aria-hidden="true">·</span>
              <AdminStatus tone={report.releaseReady ? "positive" : "danger"}>
                {report.releaseReady ? "window approved" : "release blocked"}
              </AdminStatus>
            </div>
          </div>
          {selected ? <ReviewDetail review={selected} /> : null}
        </>
      ) : loading ? (
        <p className="font-mono text-xs theme-muted">Loading quality evidence…</p>
      ) : (
        <AdminStatus tone="danger" className="font-mono text-xs">
          Quality evidence is unavailable
        </AdminStatus>
      )}
    </section>
  );
}
