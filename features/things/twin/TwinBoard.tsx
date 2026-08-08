import { useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { TwinCard } from "./TwinCard";
import { TwinHand } from "./TwinHand";
import { TwinRay } from "./TwinRay";
import { twinCardById, twinMatch } from "./twin-deck";
import { twinSymbolName } from "./twin-symbols";
import { playTwinSound } from "./twin-sound.client";
import type { TwinHeartbeatTiming } from "./twin-rules";
import { useTwinHeartbeat } from "./useTwinHeartbeat";
import { useTwinCountdown, useTwinReveal } from "./useTwinReveal";
import type { TwinSnapshot } from "./types";

const SETTLE_MATCH_MS = 560;

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
  sound,
  onTap,
  onCooldownWarning,
  heartbeatTiming,
}: {
  snapshot: TwinSnapshot;
  clockOffset: number;
  sound: boolean;
  onTap: (symbolId: string, elapsedMs: number) => void;
  onCooldownWarning?: () => void;
  heartbeatTiming?: TwinHeartbeatTiming;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const haptics = useWebHaptics();
  const heat = snapshot.heat;
  const player = snapshot.player;
  const top = player?.top ?? null;
  const completedResult = heat?.results.find(({ playerId }) => playerId === player?.playerId);
  const [showSettledMatch, setShowSettledMatch] = useState(false);
  const shownTop =
    snapshot.phase === "settle" && showSettledMatch && completedResult?.connection
      ? completedResult.connection.card
      : top;
  const shownMiddle =
    snapshot.phase === "settle" && showSettledMatch ? heat?.playedMiddle : heat?.middle;
  const pairFaceDown = snapshot.phase === "settle" && !showSettledMatch;
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
    if (snapshot.phase !== "heat" || !top || !heat) return null;
    const middle = twinCardById(snapshot.order, heat.middle.cardId);
    const mine = twinCardById(snapshot.order, top.cardId);
    return middle && mine ? twinMatch(mine, middle) : null;
  }, [heat, snapshot.order, snapshot.phase, top]);

  const [shake, setShake] = useState(0);
  const [found, setFound] = useState<string | null>(null);

  // A new heat clears the last one's connection.
  useEffect(() => {
    setFound(null);
    setShake(0);
    if (heat?.id) playTwinSound("heat", sound);
    // `sound` is read, not depended on: a mid-heat mute must not replay the opening tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the heat id is the event
  }, [heat?.id]);

  // Silent until the last few seconds, and only while you can still do something about it.
  useTwinHeartbeat(remainingMs, sound && live && !landed && !cooling, heartbeatTiming);

  // Reconcile with the server: it is the one that decides whether a tap counted.
  useEffect(() => {
    if (snapshot.phase === "heat" && landed && answer) setFound(answer);
    if (snapshot.phase !== "settle") {
      setShowSettledMatch(false);
      return;
    }
    const symbolId = completedResult?.connection?.symbolId ?? null;
    setFound(symbolId);
    setShowSettledMatch(Boolean(symbolId));
    const timer = window.setTimeout(() => {
      setFound(null);
      setShowSettledMatch(false);
    }, SETTLE_MATCH_MS);
    return () => window.clearTimeout(timer);
  }, [answer, completedResult?.connection?.symbolId, landed, snapshot.phase]);

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
      playTwinSound("connection", sound);
    } else {
      setShake((count) => count + 1);
      void haptics.trigger("warning");
      playTwinSound("miss", sound);
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
            {snapshot.phase === "dealing" ? "dealing" : settled ? "result" : ""}
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

      {snapshot.phase === "dealing" ? (
        <div className="twin-deal" role="status" aria-label="Shuffling and dealing cards">
          <div className="twin-deal-pack" aria-hidden="true">
            {Array.from({ length: 5 }, (_unused, index) => (
              <span
                key={index}
                className="twin-deal-card"
                style={
                  {
                    "--twin-deal-x": `${(index - 2) * 15}px`,
                    "--twin-deal-y": `${Math.abs(index - 2) * 3}px`,
                    "--twin-deal-rotate": `${(index - 2) * 5}deg`,
                    animationDelay: `${index * 65}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <p className="twin-deal-title">Shuffling your hand</p>
          <p className="twin-deal-note">{snapshot.handSize} cards · the first match is next</p>
        </div>
      ) : heat && shownMiddle ? (
        <div className="twin-board-cards">
          <TwinCard
            card={shownMiddle}
            slot="middle"
            label="The card in the middle"
            faceDown={pairFaceDown}
            focusSymbolId={found}
            className="twin-card--middle"
          />

          {shownTop ? (
            <TwinHand
              top={shownTop}
              rest={player?.rest ?? []}
              hint={snapshot.phase === "settle" ? "next card stays hidden" : undefined}
            >
              <TwinCard
                key={`${heat.id}-${shownTop.cardId}`}
                card={shownTop}
                slot="hand"
                label="Your card"
                faceDown={pairFaceDown}
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
              label="match"
            />
          ) : null}
        </div>
      ) : null}

      <div className="twin-board-status" aria-live="polite">
        {cooling ? (
          <p className="twin-status twin-status--cooling">
            wrong one · {(cooldownMs / 1_000).toFixed(1)}s
          </p>
        ) : found && snapshot.phase === "settle" ? (
          <p className="twin-status twin-status--found">
            match · card down ·{" "}
            {player?.top
              ? `${snapshot.players.find(({ id }) => id === player.playerId)?.cardsLeft ?? 0} left`
              : "hand empty"}
          </p>
        ) : found ? (
          <p className="twin-status twin-status--found">
            match · {twinSymbolName(found)}
            {player?.landedMs !== null && player?.landedMs !== undefined
              ? ` · ${(player.landedMs / 1_000).toFixed(2)}s`
              : ""}
          </p>
        ) : snapshot.phase === "heat" && heat && heat.number <= 1 ? (
          // Only on the opening heat. After that it is a line of text where the cards should be.
          <p className="twin-status">find the symbol on both cards</p>
        ) : null}
      </div>
    </div>
  );
}
