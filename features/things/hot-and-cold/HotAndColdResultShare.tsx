import { useEffect, useRef, useState, type CSSProperties } from "react";
import { shareOrCopy } from "@/lib/client/share";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import {
  buildHotAndColdShareResult,
  describeHotAndColdResult,
  type HotAndColdResultOutcome,
  type HotAndColdShareGuess,
} from "./hot-and-cold-share";
import type { HotAndColdCommunityStats } from "./types";

type ShareStatus = "idle" | "shared" | "copied" | "failed";

function useHotAndColdResultShare(
  label: string,
  guesses: readonly HotAndColdShareGuess[],
  hintsUsed: number,
  sharePath: string,
) {
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const [status, setStatus] = useState<ShareStatus>("idle");
  const result = buildHotAndColdShareResult({ label, guesses, hintsUsed });
  useEffect(() => {
    if (status === "idle") return;
    const reset = window.setTimeout(() => setStatus("idle"), 2_400);
    return () => window.clearTimeout(reset);
  }, [status]);
  const share = async () => {
    const url = `${location.origin}${sharePath}`;
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

function ExactBulb() {
  return (
    <svg className="heat-exact-bulb" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 15.2A6 6 0 1 1 15.8 15.2c-.9.72-1.3 1.45-1.3 2.3h-5c0-.85-.4-1.58-1.3-2.3Z" />
      <path d="M9.7 20h4.6M12 2V.75M4.7 5.1l-.9-.9M19.3 5.1l.9-.9" />
    </svg>
  );
}

function CommunityComparison({ community }: { community: HotAndColdCommunityStats }) {
  if (!community.visible)
    return (
      <div className="mt-5 border-t theme-border pt-4 text-left">
        <p className="font-mono text-micro uppercase tracking-[.12em] theme-muted">community</p>
        <p className="mt-2 font-serif text-sm leading-relaxed theme-muted">
          Details appear after 5 finished runs · {community.runs}/5 so far.
        </p>
      </div>
    );
  const zones = ["frost", "cool", "warm", "hot"] as const;
  const largest = Math.max(...Object.values(community.distribution), 1);
  return (
    <div className="mt-5 border-t theme-border pt-4 text-left">
      <div className="flex items-center justify-between gap-5">
        <div>
          <p className="font-mono text-micro uppercase tracking-[.12em] theme-muted">community</p>
          <p className="mt-1 font-mono text-micro theme-muted">{community.runs} finished runs</p>
        </div>
        <span className="heat-share-dock-bars" aria-hidden="true">
          {zones.map((zone) => (
            <span
              className="heat-share-dock-bar"
              key={zone}
              data-zone={zone}
              style={
                {
                  "--heat-share-intensity": community.distribution[zone] / largest,
                } as CSSProperties
              }
            >
              <i />
            </span>
          ))}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-4 border-y theme-border py-3">
        <div>
          <dt className="font-mono text-micro theme-muted">median</dt>
          <dd className="mt-1 font-serif text-xl">
            {community.medianGuesses.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">average</dt>
          <dd className="mt-1 font-serif text-xl">
            {community.averageGuesses.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">found it</dt>
          <dd className="mt-1 font-serif text-xl">{Math.round(community.solveRate * 100)}%</dd>
        </div>
      </dl>
    </div>
  );
}

export function HotAndColdResultShare({
  id,
  label,
  guesses,
  hintsUsed = 0,
  outcome = "found",
  sharePath = "/things/hot-and-cold",
  community = null,
}: {
  id: string;
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
  outcome?: HotAndColdResultOutcome;
  sharePath?: string;
  community?: HotAndColdCommunityStats | null;
}) {
  const resultSection = useRef<HTMLElement>(null);
  const [trailVisible, setTrailVisible] = useState(false);
  const { nativeShare, result, share, status } = useHotAndColdResultShare(
    label,
    guesses,
    hintsUsed,
    sharePath,
  );
  const closestLabel =
    result.bestRank === null
      ? "—"
      : result.bestRank === 0
        ? "exact"
        : `#${result.bestRank.toLocaleString()}`;
  const heading = describeHotAndColdResult({ result, hintsUsed, outcome });
  const exactOnly = result.guessCount === 1 && result.bestRank === 0;
  const outcomeLabel =
    outcome === "gave-up"
      ? "word revealed"
      : outcome === "round"
        ? "round complete"
        : "you found the heat";
  useEffect(() => {
    const element = resultSection.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      setTrailVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setTrailVisible(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={resultSection}
      id={id}
      className="heat-result-share"
      aria-labelledby={`${id}-title`}
      data-trail-visible={trailVisible || undefined}
      data-outcome={outcome}
    >
      <div className="heat-result-heading">
        <div className="heat-result-copy text-left">
          <p className="heat-result-eyebrow">{outcomeLabel}</p>
          <h2 id={`${id}-title`} className="mt-2 font-serif text-4xl font-semibold">
            {heading}
          </h2>
        </div>
        <p className="heat-result-label">{label}</p>
      </div>

      {exactOnly ? (
        <div
          className="heat-share-exact"
          aria-label={
            hintsUsed
              ? "Correct on the first player guess after hints"
              : "Correct on the first guess"
          }
        >
          <ExactBulb />
          <p>
            {hintsUsed ? "guided" : "straight"} to <strong>#0</strong>
          </p>
        </div>
      ) : (
        <ol className="heat-share-trail" aria-label="Distribution of guesses by temperature">
          {result.distribution.map(({ zone, count, intensity }, index) => (
            <li key={zone} data-zone={zone} aria-label={`${zone}: ${count} guesses`}>
              <span
                style={
                  {
                    "--heat-share-intensity": intensity,
                    "--heat-share-index": index,
                  } as CSSProperties
                }
                aria-hidden="true"
              />
              <small>{zone}</small>
            </li>
          ))}
        </ol>
      )}

      {result.longestHeatStreak >= 3 ? (
        <p className="heat-result-streak">
          <i aria-hidden="true" />
          best heat streak · {result.longestHeatStreak} guesses
        </p>
      ) : null}

      <dl className="heat-result-stats">
        <div className="px-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">guesses</dt>
          <dd className="mt-1 font-serif text-2xl">{result.guessCount}</dd>
        </div>
        <div className="border-x theme-border px-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">hints</dt>
          <dd className="mt-1 font-serif text-2xl">{hintsUsed}</dd>
        </div>
        <div className="px-4 py-4">
          <dt className="font-mono text-micro uppercase tracking-[.12em] theme-muted">closest</dt>
          <dd className="mt-1 font-serif text-2xl">{closestLabel}</dd>
        </div>
      </dl>

      {community ? <CommunityComparison community={community} /> : null}

      <button
        type="button"
        onClick={() => void share()}
        className="heat-share-action"
        data-status={status}
      >
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
          : status === "copied"
            ? "copied — paste it into a message"
            : hintsUsed
              ? `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} shown`
              : "no hints used"}
      </p>
    </section>
  );
}

export function HotAndColdShareDock({
  label,
  guesses,
  hintsUsed = 0,
  resultId,
  sharePath = "/things/hot-and-cold",
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
  resultId: string;
  sharePath?: string;
}) {
  const [showingResult, setShowingResult] = useState(false);
  const scrollAnimation = useRef<number | null>(null);
  const { nativeShare, result, share, status } = useHotAndColdResultShare(
    label,
    guesses,
    hintsUsed,
    sharePath,
  );
  const exactOnly = result.guessCount === 1 && result.bestRank === 0;
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
    const duration = Math.min(650, Math.max(380, Math.abs(distance) * 0.32));
    const startedAt = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - elapsed) ** 5;
      window.scrollTo({ top: startY + distance * eased });
      if (elapsed < 1) scrollAnimation.current = requestAnimationFrame(animate);
      else {
        window.scrollTo({ top: targetY });
        scrollAnimation.current = null;
      }
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
            {exactOnly ? (
              <span className="heat-share-dock-exact" aria-hidden="true">
                <ExactBulb />
              </span>
            ) : (
              <span className="heat-share-dock-bars" aria-hidden="true">
                {result.distribution.map(({ zone, intensity }) => (
                  <span
                    className="heat-share-dock-bar"
                    key={zone}
                    data-zone={zone}
                    style={{ "--heat-share-intensity": intensity } as CSSProperties}
                  >
                    <i />
                  </span>
                ))}
              </span>
            )}
            <span className="heat-share-dock-counts">
              {result.guessCount} guess{result.guessCount === 1 ? "" : "es"}
              <span aria-hidden="true"> · </span>
              <span className="heat-share-dock-hints">
                {hintsUsed > 0 ? (
                  <span className="heat-share-dock-compasses" aria-hidden="true">
                    {Array.from({ length: hintsUsed }, (_, index) => (
                      <i key={index} />
                    ))}
                  </span>
                ) : null}
                {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
              </span>
            </span>
          </span>
          <span className="heat-share-dock-pager" aria-hidden="true">
            <small>{showingResult ? "details 2/2" : "guesses 1/2"}</small>
            <span className="heat-share-page-position">
              <span className="heat-share-page-dots">
                <i data-active={!showingResult || undefined} />
                <i data-active={showingResult || undefined} />
              </span>
              <svg viewBox="0 0 16 16" data-up={showingResult || undefined}>
                <path d="m4 6 4 4 4-4" />
              </svg>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="heat-share-dock-action"
          data-status={status}
          onClick={() => void share()}
        >
          <span>{actionLabel}</span>
          <ShareIcon />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {status === "failed"
          ? "Could not share this result."
          : status === "copied"
            ? "Copied to clipboard. Paste it into a message."
            : status === "idle"
              ? ""
              : actionLabel}
      </span>
    </aside>
  );
}
