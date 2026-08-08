import type { ReactNode } from "react";
import type { TwinDealtCard } from "./types";

/**
 * Your hand: the card in play and two face-down peeks behind it. Future cards stay concealed so the
 * result animation cannot reveal the next answer to someone who scans ahead.
 */
interface TwinHandProps {
  /** The card in play, rendered by the board so it owns its own tap handling. */
  children: ReactNode;
  rest: TwinDealtCard[];
  top: TwinDealtCard | null;
  hint?: string;
}

const PEEKS = 2;

export function TwinHand({
  children,
  rest,
  top,
  hint = "future cards stay hidden",
}: TwinHandProps) {
  const cards = top ? [top, ...rest] : rest;

  return (
    <div className="twin-hand">
      <div className="twin-hand-stack">
        {rest.slice(0, PEEKS).map((card, index) => (
          <div
            key={card.cardId}
            className="twin-hand-peek"
            style={
              {
                "--twin-peek-depth": String(index + 1),
                "--twin-peek-tilt": `${(index % 2 === 0 ? -1 : 1) * 2.5}deg`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        ))}
        <div className="twin-hand-top">{children}</div>
      </div>

      <div className="twin-hand-bar">
        <p className="twin-hand-count">
          {cards.length} {cards.length === 1 ? "card" : "cards"} left
        </p>
        <p className="twin-hand-hint">{hint}</p>
      </div>
    </div>
  );
}
