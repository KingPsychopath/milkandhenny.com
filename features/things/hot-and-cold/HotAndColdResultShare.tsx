import { useState } from "react";
import { shareOrCopy } from "@/lib/client/share";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { buildHotAndColdShareResult, type HotAndColdShareGuess } from "./hot-and-cold-share";

type ShareStatus = "idle" | "shared" | "copied" | "failed";

function useHotAndColdResultShare(
  label: string,
  guesses: readonly HotAndColdShareGuess[],
  hintsUsed: number,
) {
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const [status, setStatus] = useState<ShareStatus>("idle");
  const result = buildHotAndColdShareResult({ label, guesses, hintsUsed });
  const share = async () => {
    const url = `${location.origin}/things/hot-and-cold`;
    const response = await shareOrCopy(
      { title: "Hot and Cold", text: result.text, url },
      { copyValue: `${result.text}\n\n${url}` },
    );
    if (response !== "cancelled") setStatus(response);
  };
  return { nativeShare, result, share, status };
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 11.5v7.25A2.25 2.25 0 0 0 7.25 21h9.5A2.25 2.25 0 0 0 19 18.75V11.5" />
    </svg>
  );
}

export function HotAndColdResultShare({
  label,
  guesses,
  hintsUsed = 0,
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
}) {
  const { nativeShare, result, share, status } = useHotAndColdResultShare(
    label,
    guesses,
    hintsUsed,
  );
  const closestLabel =
    result.bestRank === null
      ? "—"
      : result.bestRank === 0
        ? "exact"
        : `#${result.bestRank.toLocaleString()}`;

  return (
    <section className="heat-result-share" aria-labelledby="heat-result-share-title">
      <div className="heat-result-heading">
        <div className="text-left">
          <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">your trail</p>
          <h2 id="heat-result-share-title" className="mt-2 font-serif text-4xl font-semibold">
            from frost to fire.
          </h2>
        </div>
        <p>{label}</p>
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
              <small>{guess.band}</small>
            </li>
          ))
        ) : (
          <li className="heat-share-trail-empty">no guesses</li>
        )}
      </ol>

      <dl className="heat-result-stats">
        <div className="py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">guesses</dt>
          <dd className="mt-1 font-serif text-2xl">{result.guessCount}</dd>
        </div>
        <div className="border-x theme-border px-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">hints</dt>
          <dd className="mt-1 font-serif text-2xl">{hintsUsed}</dd>
        </div>
        <div className="pl-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">closest</dt>
          <dd className="mt-1 font-serif text-2xl">{closestLabel}</dd>
        </div>
      </dl>

      <button type="button" onClick={() => void share()} className="heat-share-action">
        <span>
          {status === "copied"
            ? "copied to clipboard"
            : status === "shared"
              ? "shared"
              : status === "failed"
                ? "try sharing again"
                : nativeShare
                  ? "share this trail"
                  : "copy this trail"}
        </span>
        <ShareIcon />
      </button>
      <p className="mt-3 min-h-4 font-mono text-micro theme-faint" aria-live="polite">
        {status === "failed"
          ? "Could not copy this result."
          : `spoiler-free · ${hintsUsed ? `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} shown` : "no hints"}`}
      </p>
    </section>
  );
}

export function HotAndColdShareDock({
  label,
  guesses,
  hintsUsed = 0,
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
}) {
  const { nativeShare, result, share, status } = useHotAndColdResultShare(
    label,
    guesses,
    hintsUsed,
  );
  const actionLabel =
    status === "copied"
      ? "copied"
      : status === "shared"
        ? "shared"
        : status === "failed"
          ? "retry"
          : nativeShare
            ? "share"
            : "copy";

  return (
    <aside className="heat-share-dock" aria-label="Share your result">
      <div className="heat-share-dock-inner">
        <div className="heat-share-dock-summary">
          <ol aria-label="Your heat journey">
            {result.trail.map((guess) => (
              <li key={`${guess.sequence}:${guess.rank}`} data-band={guess.band}>
                <span />
              </li>
            ))}
          </ol>
          <p>
            {result.guessCount} guess{result.guessCount === 1 ? "" : "es"}
            <span aria-hidden="true"> · </span>
            {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" onClick={() => void share()}>
          <span>{actionLabel}</span>
          <ShareIcon />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {status === "failed"
          ? "Could not share this result."
          : status === "idle"
            ? ""
            : actionLabel}
      </span>
    </aside>
  );
}
