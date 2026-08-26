import { useLayoutEffect, useRef, useState } from "react";
import { heatBand, orderGuesses } from "./hot-and-cold-rules";
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
  emptyMessage = "Start anywhere. A broad word is a good first spark.",
}: {
  guesses: readonly LedgerGuess[];
  newestId?: string | null;
  target?: string | null;
  emptyMessage?: string;
}) {
  const ledger = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offscreenUpdate, setOffscreenUpdate] = useState<string | null>(null);
  const ordered = orderGuesses(guesses);
  const newestGuess = newestId ? guesses.find(({ id }) => id === newestId) : undefined;
  const newestRank = newestGuess?.rank;
  const newestWord = newestGuess?.word;
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
    const visibleTop = Math.max(0, sourceBottom ?? 0);
    const visibleBottom = Math.min(window.innerHeight, composerTop ?? window.innerHeight);
    if (rowBounds.bottom > visibleTop && rowBounds.top < visibleBottom) return;

    const rank = `#${newestRank.toLocaleString()}`;
    const direction = rowBounds.bottom <= visibleTop ? "above" : "below";
    setOffscreenUpdate(`${newestWord} · ${rank} · added ${direction}`);
    updateTimer.current = setTimeout(() => setOffscreenUpdate(null), 2_800);
    return () => {
      if (updateTimer.current) clearTimeout(updateTimer.current);
    };
  }, [newestId, newestRank, newestWord]);

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
      <ol ref={ledger} className="heat-ledger" aria-label="Guesses ordered from hottest to coldest">
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
                  <span>{LABELS[band]}</span>
                </div>
              ) : null}
              <article
                data-guess-id={guess.id}
                data-newest={guess.id === newestId || undefined}
                className={`heat-word heat-word--${band}`}
              >
                <span className="heat-word-rank">
                  {`#${guess.rank.toLocaleString()}`}
                </span>
                <span className="heat-word-text">{guess.word}</span>
                <span className="heat-word-owner">{owner}</span>
                <span className="heat-word-effect" aria-hidden="true" />
              </article>
            </li>
          );
        })}
      </ol>
      {offscreenUpdate ? (
        <p className="heat-ledger-update" role="status">
          {offscreenUpdate}
        </p>
      ) : null}
    </>
  );
}
