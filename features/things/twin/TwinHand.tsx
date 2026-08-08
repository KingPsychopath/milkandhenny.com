import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TwinCard } from "./TwinCard";
import type { TwinDealtCard } from "./types";

/**
 * Your hand: the card in play, the two behind it, and the fan.
 *
 * The fan only opens between heats. Knowing your next three cards lets you pre-scan while the previous
 * result is still animating, and a player who does that every heat runs away with it against people who
 * do not — so `canFan` goes false at reveal and the fan shuts itself, visibly. That restriction is also
 * what keeps the gesture unambiguous: while the top card is accepting taps there is no drag to compete
 * with them, because there is nothing to open.
 */
interface TwinHandProps {
  /** The card in play, rendered by the board so it owns its own tap handling. */
  children: ReactNode;
  rest: TwinDealtCard[];
  top: TwinDealtCard | null;
  canFan: boolean;
}

const PEEKS = 2;

export function TwinHand({ children, rest, top, canFan }: TwinHandProps) {
  const [fanned, setFanned] = useState(false);
  const [focus, setFocus] = useState(0);
  const dragFrom = useRef<{ x: number; focus: number } | null>(null);
  const cards = top ? [top, ...rest] : rest;

  // The heat is starting. Shut the fan whether or not anyone asked.
  useEffect(() => {
    if (!canFan) setFanned(false);
  }, [canFan]);

  useEffect(() => {
    if (fanned) setFocus(0);
  }, [fanned]);

  const step = useCallback(
    (delta: number) =>
      setFocus((current) => Math.min(cards.length - 1, Math.max(0, current + delta))),
    [cards.length],
  );

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
        {canFan && cards.length > 1 ? (
          <button type="button" className="twin-hand-open" onClick={() => setFanned(true)}>
            see what&rsquo;s next
          </button>
        ) : (
          <p className="twin-hand-hint">{canFan ? "last card" : "hand closed for the heat"}</p>
        )}
      </div>

      {fanned ? (
        <div className="twin-fan" role="dialog" aria-modal="true" aria-label="Your hand">
          <button
            type="button"
            className="twin-fan-backdrop"
            aria-label="Close your hand"
            onClick={() => setFanned(false)}
          />
          <div
            className="twin-fan-arc"
            onPointerDown={(event) => {
              dragFrom.current = { x: event.clientX, focus };
            }}
            onPointerMove={(event) => {
              const start = dragFrom.current;
              if (!start) return;
              // One card per 64px of travel — enough that a tap never counts as a slide.
              const moved = Math.round((start.x - event.clientX) / 64);
              setFocus(Math.min(cards.length - 1, Math.max(0, start.focus + moved)));
            }}
            onPointerUp={() => {
              dragFrom.current = null;
            }}
            onPointerCancel={() => {
              dragFrom.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") step(1);
              if (event.key === "ArrowLeft") step(-1);
              if (event.key === "Escape") setFanned(false);
            }}
          >
            {cards.map((card, index) => {
              const offset = index - focus;
              return (
                <button
                  key={card.cardId}
                  type="button"
                  className="twin-fan-slot"
                  style={
                    {
                      "--twin-fan-offset": String(offset),
                      "--twin-fan-distance": String(Math.abs(offset)),
                      zIndex: cards.length - Math.abs(offset),
                    } as React.CSSProperties
                  }
                  onClick={() => setFocus(index)}
                  aria-current={index === focus}
                  aria-label={`Card ${index + 1} of ${cards.length}`}
                >
                  <TwinCard
                    card={card}
                    slot="review"
                    label={index === 0 ? "Your card in play" : `Card ${index + 1} in your hand`}
                  />
                </button>
              );
            })}
          </div>
          <div className="twin-fan-foot">
            <p className="twin-fan-position">
              {focus + 1} of {cards.length}
              {focus === 0 ? " · in play" : ""}
            </p>
            <button type="button" className="twin-fan-close" onClick={() => setFanned(false)}>
              done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
