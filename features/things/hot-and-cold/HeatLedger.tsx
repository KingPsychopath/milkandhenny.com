import { useEffect, useRef } from "react";
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
  const ordered = orderGuesses(guesses);
  useEffect(() => {
    if (!newestId || !ledger.current) return;
    const row = ledger.current.querySelector<HTMLElement>(
      `[data-guess-id="${CSS.escape(newestId)}"]`,
    );
    if (row && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      row.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [newestId]);

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
    <ol ref={ledger} className="heat-ledger" aria-label="Guesses ordered from hottest to coldest">
      {showRevealedTarget ? (
        <li className="heat-target">
          <span>0</span>
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
          <li key={guess.id}>
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
                {guess.rank === 0 ? "0" : `#${guess.rank.toLocaleString()}`}
              </span>
              <span className="heat-word-text">{guess.word}</span>
              <span className="heat-word-owner">{owner}</span>
              <span className="heat-word-effect" aria-hidden="true" />
            </article>
          </li>
        );
      })}
    </ol>
  );
}
