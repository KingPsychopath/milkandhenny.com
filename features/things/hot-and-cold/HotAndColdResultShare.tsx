import { useEffect, useRef, useState, type CSSProperties } from "react";
import { shareOrCopy } from "@/lib/client/share";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import {
  buildHotAndColdShareResult,
  describeHotAndColdResult,
  type HotAndColdResultOutcome,
  type HotAndColdShareGuess,
} from "./hot-and-cold-share";

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
  id,
  label,
  guesses,
  hintsUsed = 0,
  outcome = "found",
}: {
  id: string;
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
  outcome?: HotAndColdResultOutcome;
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
  const heading = describeHotAndColdResult({ result, hintsUsed, outcome });

  return (
    <section id={id} className="heat-result-share" aria-labelledby={`${id}-title`}>
      <div className="heat-result-heading">
        <div className="heat-result-copy text-left">
          <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">your trail</p>
          <h2 id={`${id}-title`} className="mt-2 font-serif text-4xl font-semibold">
            {heading}
          </h2>
        </div>
        <p className="heat-result-label">{label}</p>
      </div>

      <ol className="heat-share-trail" aria-label="Distribution of guesses by temperature">
        {result.distribution.map(({ zone, count, intensity }) => (
          <li key={zone} data-zone={zone} aria-label={`${zone}: ${count} guesses`}>
            <span
              style={{ "--heat-share-intensity": intensity } as CSSProperties}
              aria-hidden="true"
            />
            <small>{zone}</small>
          </li>
        ))}
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
  resultId,
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
  resultId: string;
}) {
  const [showingResult, setShowingResult] = useState(false);
  const scrollAnimation = useRef<number | null>(null);
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
  useEffect(() => {
    const resultElement = document.getElementById(resultId);
    if (!resultElement) return;
    const observer = new IntersectionObserver(([entry]) => setShowingResult(entry.isIntersecting), {
      threshold: 0.55,
    });
    observer.observe(resultElement);
    return () => observer.disconnect();
  }, [resultId]);
  useEffect(
    () => () => {
      if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current);
    },
    [],
  );

  const jumpPage = () => {
    const target = document.getElementById(showingResult ? "main" : resultId);
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targetY = showingResult
      ? 0
      : target.getBoundingClientRect().top + window.scrollY - 6 * 16;
    if (reducedMotion) {
      window.scrollTo({ top: targetY });
      return;
    }
    if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current);
    const startY = window.scrollY;
    const distance = targetY - startY;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / 820);
      const spring = elapsed === 1 ? 1 : 1 - Math.exp(-8 * elapsed) * Math.cos(9 * elapsed);
      window.scrollTo({ top: startY + distance * spring });
      if (elapsed < 1) scrollAnimation.current = requestAnimationFrame(animate);
      else scrollAnimation.current = null;
    };
    scrollAnimation.current = requestAnimationFrame(animate);
  };

  return (
    <aside className="heat-share-dock" aria-label="Share your result">
      <div className="heat-share-dock-inner">
        <button
          type="button"
          className="heat-share-dock-nav"
          aria-label={showingResult ? "Back to your guesses" : "See your result"}
          onClick={jumpPage}
        >
          <span className="heat-share-dock-summary">
            <span className="heat-share-dock-bars" aria-hidden="true">
              {result.trail.map((guess) => (
                <span
                  className="heat-share-dock-bar"
                  key={`${guess.sequence}:${guess.rank}`}
                  data-band={guess.band}
                >
                  <i />
                </span>
              ))}
            </span>
            <span className="heat-share-dock-counts">
              {result.guessCount} guess{result.guessCount === 1 ? "" : "es"}
              <span aria-hidden="true"> · </span>
              {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
            </span>
          </span>
          <span className="heat-share-dock-pager" aria-hidden="true">
            <span className="heat-share-page-dots">
              <i data-active={!showingResult || undefined} />
              <i data-active={showingResult || undefined} />
            </span>
            <svg viewBox="0 0 16 16" data-up={showingResult || undefined}>
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        </button>
        <button type="button" className="heat-share-dock-action" onClick={() => void share()}>
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
