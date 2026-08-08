import { useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { TwinCard } from "./TwinCard";
import { TwinHand } from "./TwinHand";
import { TwinRay } from "./TwinRay";
import { twinCardById, twinMatch } from "./twin-deck";
import { twinSymbolName } from "./twin-symbols";
import { useTwinCountdown, useTwinReveal } from "./useTwinReveal";
import type { TwinSnapshot } from "./types";

/**
 * The heat: the middle card, your card, and a clock.
 *
 * Nothing else is on screen while it runs — no scores, no leaderboard, no other players' cards. The
 * heat is a hunt, and everything else is a reason to look away from the cards. Other people's results
 * arrive after it closes.
 */
export function TwinBoard({
  snapshot,
  clockOffset,
  onTap,
  onCooldownWarning,
}: {
  snapshot: TwinSnapshot;
  clockOffset: number;
  onTap: (symbolId: string, elapsedMs: number) => void;
  onCooldownWarning?: () => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const haptics = useWebHaptics();
  const heat = snapshot.heat;
  const player = snapshot.player;
  const top = player?.top ?? null;
  const revealedAt = useTwinReveal(heat?.id ?? null, heat?.revealAt ?? null, clockOffset);

  const live = snapshot.phase === "heat" && heat !== null && revealedAt !== null;
  const landed = player?.landedMs !== null && player?.landedMs !== undefined;
  const now = Date.now() + clockOffset;
  const cooling = (player?.cooldownUntil ?? 0) > now;

  const remainingMs = useTwinCountdown(
    heat ? (heat.graceEndsAt ?? heat.deadlineAt) : null,
    clockOffset,
    snapshot.phase === "heat",
  );
  const cooldownMs = useTwinCountdown(player?.cooldownUntil ?? null, clockOffset, cooling);

  /**
   * The answer, computed locally.
   *
   * The client holds both cards, so it can confirm a tap the instant it happens instead of waiting a
   * round trip to find out whether the thing you already know you got right was right. The server
   * still rules — this only buys the animation and the haptic, which are what make it feel like a game.
   */
  const answer = useMemo(() => {
    if (!top || !heat) return null;
    const middle = twinCardById(snapshot.order, heat.middle.cardId);
    const mine = twinCardById(snapshot.order, top.cardId);
    return middle && mine ? twinMatch(mine, middle) : null;
  }, [heat, snapshot.order, top]);

  const [shake, setShake] = useState(0);
  const [found, setFound] = useState<string | null>(null);

  // A new heat clears the last one's connection.
  useEffect(() => {
    setFound(null);
    setShake(0);
  }, [heat?.id]);

  // Reconcile with the server: it is the one that decides whether a tap counted.
  useEffect(() => {
    if (landed && answer) setFound(answer);
  }, [answer, landed]);

  const handleTap = (symbolId: string) => {
    if (!live || landed || cooling) {
      if (cooling) {
        onCooldownWarning?.();
        void haptics.trigger("warning");
      }
      return;
    }
    const elapsedMs = Math.round(performance.now() - (revealedAt ?? performance.now()));
    if (symbolId === answer) {
      setFound(symbolId);
      void haptics.trigger("success");
    } else {
      setShake((count) => count + 1);
      void haptics.trigger("warning");
    }
    onTap(symbolId, elapsedMs);
  };

  const settled = snapshot.phase === "settle" && heat !== null && heat.results.length > 0;
  const seconds = Math.ceil(remainingMs / 100) / 10;

  return (
    <div className="twin-board" ref={boardRef}>
      <div className="twin-board-clock">
        {snapshot.phase === "heat" ? (
          <>
            <div
              className="twin-clock-bar"
              style={
                {
                  // The bar drains against whichever deadline is actually in force.
                  "--twin-clock-fill": String(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        remainingMs /
                          Math.max(
                            1,
                            heat?.graceEndsAt !== null ? snapshot.graceMs : snapshot.windowMs,
                          ),
                      ),
                    ),
                  ),
                } as React.CSSProperties
              }
              data-urgent={remainingMs < 1_500 ? "true" : "false"}
            />
            <p className="twin-clock-read" aria-live="off">
              <TextMorph as="span">{seconds.toFixed(1)}</TextMorph>
              <span className="twin-clock-unit">s</span>
            </p>
          </>
        ) : (
          <p className="twin-clock-read twin-clock-read--idle">
            {snapshot.phase === "dealing" ? "dealing" : settled ? "next heat" : ""}
          </p>
        )}
        <p className="twin-board-tally" aria-live="polite">
          {heat && snapshot.phase === "heat" && heat.landedCount > 0
            ? `${heat.landedCount} ${heat.landedCount === 1 ? "has" : "have"} it`
            : heat
              ? `heat ${heat.number}`
              : ""}
        </p>
      </div>

      {heat ? (
        <div className="twin-board-cards">
          <TwinCard
            card={heat.middle}
            slot="middle"
            label="The card in the middle"
            focusSymbolId={found}
            className="twin-card--middle"
          />

          {top ? (
            <TwinHand top={top} rest={player?.rest ?? []} canFan={snapshot.phase !== "heat"}>
              <TwinCard
                key={`${heat.id}-${top.cardId}`}
                card={top}
                slot="hand"
                label="Your card"
                onTap={handleTap}
                disabled={!live || landed}
                focusSymbolId={found}
                className={`twin-card--mine ${cooling ? "twin-card--cooling" : ""} ${
                  shake > 0 ? "twin-card--shake" : ""
                }`}
              />
            </TwinHand>
          ) : (
            <p className="twin-board-empty">Your hand is empty.</p>
          )}

          {found ? (
            <TwinRay
              containerRef={boardRef}
              from={{ slot: "hand", symbolId: found }}
              to={{ slot: "middle", symbolId: found }}
              token={`${heat.id}-${found}`}
            />
          ) : null}
        </div>
      ) : null}

      <div className="twin-board-status" aria-live="polite">
        {cooling ? (
          <p className="twin-status twin-status--cooling">
            wrong one · {(cooldownMs / 1_000).toFixed(1)}s
          </p>
        ) : found ? (
          <p className="twin-status twin-status--found">
            {twinSymbolName(found)}
            {player?.landedMs !== null && player?.landedMs !== undefined
              ? ` · ${(player.landedMs / 1_000).toFixed(2)}s`
              : ""}
          </p>
        ) : snapshot.phase === "heat" ? (
          <p className="twin-status">find the symbol on both cards</p>
        ) : null}
      </div>
    </div>
  );
}
