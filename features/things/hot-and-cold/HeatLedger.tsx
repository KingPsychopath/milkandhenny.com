import { useLayoutEffect, useRef, useState } from "react";
import { heatBand, offscreenGuessDirection, orderGuesses } from "./hot-and-cold-rules";
import type { HeatBand } from "./hot-and-cold-rules";

export interface LedgerGuess {
  id: string;
  sequence: number;
  word: string;
  rank: number;
  band: HeatBand;
  playerName?: string;
  mine?: boolean;
}

const LABELS: Record<HeatBand, string> = {
  found: "found it",
  burning: "burning",
  hot: "hot",
  warm: "warm",
  cool: "cool",
  cold: "cold",
  frozen: "frozen",
};

export function HeatLedger({
  guesses,
  newestId,
  target,
  wordsHidden = false,
  emptyMessage = "Start anywhere. A broad word is a good first spark.",
}: {
  guesses: readonly LedgerGuess[];
  newestId?: string | null;
  target?: string | null;
  wordsHidden?: boolean;
  emptyMessage?: string;
}) {
  const ledger = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offscreenUpdate, setOffscreenUpdate] = useState<{
    guessId: string;
    label: string;
  } | null>(null);
  const ordered = orderGuesses(guesses);
  const newestGuess = newestId ? guesses.find(({ id }) => id === newestId) : undefined;
  const newestRank = newestGuess?.rank;
  const newestWord = newestGuess?.word;
  const bandCounts = ordered.reduce(
    (counts, guess) => {
      const band = heatBand(guess.rank);
      counts[band] += 1;
      return counts;
    },
    { found: 0, burning: 0, hot: 0, warm: 0, cool: 0, cold: 0, frozen: 0 },
  );
  useLayoutEffect(() => {
    if (!ledger.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextPositions = new Map<string, number>();
    for (const item of ledger.current.querySelectorAll<HTMLElement>("[data-ledger-item]")) {
      const id = item.dataset.ledgerItem;
      if (!id) continue;
      const nextTop = item.getBoundingClientRect().top;
      const previousTop = positions.current.get(id);
      nextPositions.set(id, nextTop);
      if (!reducedMotion && previousTop !== undefined && Math.abs(previousTop - nextTop) > 1)
        item.animate(
          [{ transform: `translateY(${previousTop - nextTop}px)` }, { transform: "translateY(0)" }],
          { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
    }
    positions.current = nextPositions;
  }, [ordered]);
  useLayoutEffect(() => {
    if (updateTimer.current) clearTimeout(updateTimer.current);
    setOffscreenUpdate(null);
    if (!newestId || newestRank === undefined || !newestWord || !ledger.current) return;
    const row = ledger.current.querySelector<HTMLElement>(
      `[data-guess-id="${CSS.escape(newestId)}"]`,
    );
    if (!row) return;

    const rowBounds = row.getBoundingClientRect();
    const sourceBottom = document
      .querySelector<HTMLElement>(".heat-source")
      ?.getBoundingClientRect().bottom;
    const composerTop = document
      .querySelector<HTMLElement>(".heat-composer")
      ?.getBoundingClientRect().top;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
    const visibleTop = Math.max(viewportTop, sourceBottom ?? viewportTop);
    const visibleBottom = Math.min(viewportBottom, composerTop ?? viewportBottom);
    const direction = offscreenGuessDirection(
      { top: rowBounds.top, bottom: rowBounds.bottom },
      { top: visibleTop, bottom: visibleBottom },
    );
    if (!direction) return;

    const rank = `#${newestRank.toLocaleString()}`;
    setOffscreenUpdate({
      guessId: newestId,
      label: `${wordsHidden ? rank : `${newestWord} · ${rank}`} · added ${direction}`,
    });
    updateTimer.current = setTimeout(() => setOffscreenUpdate(null), 2_800);
    return () => {
      if (updateTimer.current) clearTimeout(updateTimer.current);
    };
  }, [newestId, newestRank, newestWord, wordsHidden]);
  const showOffscreenGuess = () => {
    if (!offscreenUpdate || !ledger.current) return;
    const row = ledger.current.querySelector<HTMLElement>(
      `[data-guess-id="${CSS.escape(offscreenUpdate.guessId)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
    if (updateTimer.current) clearTimeout(updateTimer.current);
    setOffscreenUpdate(null);
  };

  const showRevealedTarget = Boolean(target && !ordered.some(({ rank }) => rank === 0));
  if (ordered.length === 0 && !showRevealedTarget)
    return (
      <div className="heat-ledger-empty">
        <span aria-hidden="true">↟</span>
        <p>{emptyMessage}</p>
      </div>
    );
  let previousBand: HeatBand | null = null;
  return (
    <>
      <ol
        ref={ledger}
        className="heat-ledger"
        aria-label={`Guesses ordered from hottest to coldest${wordsHidden ? "; words hidden" : ""}`}
        data-words-hidden={wordsHidden || undefined}
      >
        {showRevealedTarget ? (
          <li className="heat-target">
            <span>#0</span>
            <strong>{target}</strong>
            <small>the word</small>
          </li>
        ) : null}
        {ordered.map((guess, index) => {
          const band = heatBand(guess.rank);
          const divider = band !== previousBand;
          const owner = [
            guess.playerName,
            guess.mine ? "you" : null,
            index === 0 && guess.rank !== 0 ? "hottest" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          previousBand = band;
          return (
            <li key={guess.id} data-ledger-item={guess.id}>
              {divider ? (
                <div className={`heat-band heat-band--${band}`}>
                  <i className="heat-band-thermometer" aria-hidden="true" />
                  <span>
                    {LABELS[band]}
                    {wordsHidden
                      ? ` · ${bandCounts[band]} word${bandCounts[band] === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </div>
              ) : null}
              <article
                data-guess-id={guess.id}
                data-newest={guess.id === newestId || undefined}
                className={`heat-word heat-word--${band}`}
              >
                <span className="heat-word-rank">{`#${guess.rank.toLocaleString()}`}</span>
                <span className="heat-word-text">{guess.word}</span>
                <span className="heat-word-owner">{owner}</span>
                <span className="heat-word-effect" aria-hidden="true" />
              </article>
            </li>
          );
        })}
      </ol>
      {offscreenUpdate ? (
        <button
          type="button"
          className="heat-ledger-update"
          aria-label={`${offscreenUpdate.label}. Show in ledger`}
          aria-live="polite"
          aria-atomic="true"
          onPointerDown={(event) => event.preventDefault()}
          onClick={showOffscreenGuess}
        >
          <span>{offscreenUpdate.label}</span>
          <strong aria-hidden="true">show</strong>
        </button>
      ) : null}
    </>
  );
}
