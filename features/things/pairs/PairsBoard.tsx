import type { CSSProperties } from "react";
import type { PairsCard, PairsGame } from "./pairs-rules";

function CardFace({ card }: { card: PairsCard }) {
  return (
    <span
      className={`pairs-face pairs-face--front ${card.suit === "♥" || card.suit === "♦" ? "pairs-face--red" : ""}`}
    >
      <span className="pairs-corner">
        <b>{card.rank}</b>
        <span>{card.suit}</span>
      </span>
      <span className="pairs-pip">{card.suit}</span>
      <span className="pairs-corner pairs-corner--bottom">
        <b>{card.rank}</b>
        <span>{card.suit}</span>
      </span>
    </span>
  );
}

export function PairsBoard({
  game,
  onFlip,
  preview = false,
}: {
  game: PairsGame;
  onFlip?: (index: number) => void;
  preview?: boolean;
}) {
  return (
    <div
      className={`pairs-board pairs-board--${game.cards.length} ${preview ? "pairs-board--preview" : ""}`}
      role={preview ? undefined : "group"}
      aria-label={preview ? undefined : "Memory cards"}
      aria-hidden={preview || undefined}
    >
      {game.cards.map((card, index) => {
        const shown = game.selected.includes(index);
        const matched = game.matched.includes(index);
        const falling = matched && shown;
        const style: CSSProperties & {
          "--deal-delay": string;
          "--card-tilt": string;
          "--fall-x": string;
        } = {
          "--deal-delay": `${index * 45}ms`,
          "--card-tilt": `${index % 2 === 0 ? -3 : 3}deg`,
          "--fall-x": `${index % 2 === 0 ? -35 : 35}px`,
        };
        return (
          <div
            key={index}
            className={`pairs-slot ${matched && !falling ? "pairs-slot--empty" : ""}`}
            style={style}
          >
            <span className="pairs-slot-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className={`pairs-card-drop ${falling ? "pairs-card-drop--fall" : ""}`}>
              {preview ? (
                <div className="pairs-card pairs-card--preview">
                  <span className="pairs-face pairs-face--back">
                    <span className="pairs-monogram">
                      m<span>&</span>h
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={`pairs-card ${shown ? "pairs-card--shown" : ""}`}
                  disabled={!onFlip || game.phase !== "playing" || shown || matched}
                  aria-label={`Card ${index + 1}: ${matched ? `matched ${card.rank}` : shown ? `${card.rank} of ${suitName(card.suit)}` : "face down"}`}
                  aria-pressed={shown}
                  onClick={() => onFlip?.(index)}
                >
                  <span className="pairs-face pairs-face--back" aria-hidden="true">
                    <span className="pairs-monogram">
                      m<span>&</span>h
                    </span>
                  </span>
                  {/* Face-down values never enter the DOM: visual concealment alone invites accidental spoilers. */}
                  {shown ? (
                    <CardFace card={card} />
                  ) : (
                    <span className="pairs-face pairs-face--front" />
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function suitName(suit: PairsCard["suit"]) {
  return suit === "♠" ? "spades" : suit === "♥" ? "hearts" : suit === "♣" ? "clubs" : "diamonds";
}
