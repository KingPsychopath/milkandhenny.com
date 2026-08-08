import { useMemo } from "react";
import { twinLayout } from "./twin-layout";
import { twinSymbolHue, twinSymbolName } from "./twin-symbols";
import { TwinSymbol } from "./TwinSymbol";
import type { TwinDealtCard } from "./types";

interface TwinCardProps {
  card: TwinDealtCard;
  /**
   * Present only on a card whose symbols can be claimed — which is never the middle card. A tap on the
   * middle card has no owner when two people share one screen, so the rule is the same in every mode:
   * you tap your own card.
   */
  onTap?: (symbolId: string) => void;
  disabled?: boolean;
  faceDown?: boolean;
  /** The connection beat: this symbol holds full strength while the rest of the card drops back. */
  focusSymbolId?: string | null;
  /**
   * Marks this card in the DOM so the ray can find a symbol on it without ref plumbing. A union
   * rather than a string because a typo here would silently leave the ray with nothing to measure.
   */
  slot: "middle" | "hand" | "review" | "review-shed" | "review-middle" | "seat-one" | "seat-two";
  label: string;
  className?: string;
}

export function TwinCard({
  card,
  onTap,
  disabled = false,
  faceDown = false,
  focusSymbolId = null,
  slot,
  label,
  className = "",
}: TwinCardProps) {
  const placements = useMemo(
    () => (card.symbolIds.length > 0 ? twinLayout(card.symbolIds, card.seed) : []),
    [card.symbolIds, card.seed],
  );

  return (
    <div
      className={`twin-card ${faceDown ? "twin-card--down" : ""} ${className}`}
      data-twin-card={slot}
      data-twin-card-id={card.cardId}
      role="group"
      aria-label={label}
    >
      {faceDown
        ? null
        : placements.map((placement) => {
            const focused = focusSymbolId === placement.symbolId;
            const dimmed = focusSymbolId !== null && !focused;
            const style = {
              left: `${placement.x * 100}%`,
              top: `${placement.y * 100}%`,
              width: `${placement.size * 100}%`,
              height: `${placement.size * 100}%`,
              // The rotation lives here rather than on the svg so the focus scale can compose with it.
              "--twin-symbol-rotation": `${placement.rotation}deg`,
              // Only picked up when the coloured deck is on; otherwise the symbol inherits the ink.
              "--twin-symbol-hue": `var(--twin-hue-${twinSymbolHue(placement.symbolId)})`,
            } as React.CSSProperties;

            const content = <TwinSymbol id={placement.symbolId} className="twin-symbol-art" />;
            const classes = `twin-symbol ${focused ? "twin-symbol--found" : ""} ${
              dimmed ? "twin-symbol--dimmed" : ""
            }`;

            return onTap ? (
              <button
                key={placement.symbolId}
                type="button"
                data-twin-symbol={placement.symbolId}
                className={classes}
                style={style}
                disabled={disabled}
                onPointerDown={(event) => {
                  // Claim on press rather than click: this is a race, and a click waits for release.
                  if (event.button !== 0 && event.pointerType === "mouse") return;
                  event.preventDefault();
                  onTap(placement.symbolId);
                }}
                aria-label={twinSymbolName(placement.symbolId)}
              >
                {content}
              </button>
            ) : (
              <span
                key={placement.symbolId}
                data-twin-symbol={placement.symbolId}
                className={classes}
                style={style}
              >
                {content}
              </span>
            );
          })}
    </div>
  );
}
