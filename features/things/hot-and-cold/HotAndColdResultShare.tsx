import { useState } from "react";
import { shareOrCopy } from "@/lib/client/share";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { buildHotAndColdShareResult, type HotAndColdShareGuess } from "./hot-and-cold-share";

export function HotAndColdResultShare({
  label,
  guesses,
  outcome,
  hintsUsed = 0,
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  outcome: "found" | "revealed" | "closest";
  hintsUsed?: number;
}) {
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const [status, setStatus] = useState<"idle" | "shared" | "copied" | "failed">("idle");
  const result = buildHotAndColdShareResult({ label, guesses, outcome, hintsUsed });
  const closestLabel =
    result.bestRank === null
      ? "—"
      : result.bestRank === 0
        ? "exact"
        : `#${result.bestRank.toLocaleString()}`;

  const share = async () => {
    const url = `${location.origin}/things/hot-and-cold`;
    const response = await shareOrCopy(
      { title: "Hot and Cold", text: result.text, url },
      { copyValue: `${result.text}\n\n${url}` },
    );
    if (response !== "cancelled") setStatus(response);
  };

  return (
    <section className="heat-result-share" aria-labelledby="heat-result-share-title">
      <div className="flex items-end justify-between gap-5">
        <div className="text-left">
          <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">your trail</p>
          <h2 id="heat-result-share-title" className="mt-2 font-serif text-3xl font-semibold">
            from frost to fire.
          </h2>
        </div>
        <span className="font-mono text-micro uppercase tracking-[.14em] theme-faint">
          spoiler free
        </span>
      </div>

      <ol className="heat-share-trail" aria-label="Chronological heat milestones">
        {result.trail.length ? (
          result.trail.map((guess, index) => (
            <li
              key={`${guess.sequence}:${guess.rank}`}
              data-band={guess.band}
              aria-label={`Milestone ${index + 1}: ${guess.band}, rank ${guess.rank}`}
            >
              <span aria-hidden="true" />
            </li>
          ))
        ) : (
          <li className="heat-share-trail-empty">no guesses</li>
        )}
      </ol>

      <dl className="grid grid-cols-3 border-y theme-border text-left">
        <div className="py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">guesses</dt>
          <dd className="mt-1 font-serif text-2xl">{result.guessCount}</dd>
        </div>
        <div className="border-x theme-border px-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">closest</dt>
          <dd className="mt-1 font-serif text-2xl">{closestLabel}</dd>
        </div>
        <div className="pl-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">coldest</dt>
          <dd className="mt-1 font-serif text-2xl">
            {result.coldestRank === null ? "—" : `#${result.coldestRank.toLocaleString()}`}
          </dd>
        </div>
      </dl>

      {hintsUsed > 0 ? (
        <p className="mt-3 text-left font-mono text-micro theme-muted">
          assisted · {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void share()}
        className="mt-5 min-h-14 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-xs font-bold text-black disabled:opacity-50"
      >
        {status === "copied"
          ? "copied to clipboard"
          : status === "shared"
            ? "shared"
            : status === "failed"
              ? "try sharing again"
              : nativeShare
                ? "share result"
                : "copy result"}
      </button>
      <p className="mt-3 min-h-4 font-mono text-micro theme-faint" aria-live="polite">
        {status === "failed" ? "Could not copy this result." : "No words are included."}
      </p>
    </section>
  );
}
