import { useEffect, useRef } from "react";
import { twinCardById, twinMatch } from "./twin-deck";
import { applyTwinActionFn, readTwinSnapshotFn } from "./twin-room.functions";

/**
 * A seat played by the machine. **Development only.**
 *
 * It does nothing a player could not do: reads its own snapshot through the same server function, finds
 * the match from the two cards it was sent, waits a human-ish moment, and taps. It never touches room
 * state directly and it gets no information a real player lacks — which is what makes it usable as a
 * test driver. If a bot can see something it should not, so can a person.
 *
 * It exists because verifying a ten-player ending otherwise needs ten hands.
 */
export function useTwinBot(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  enabled: boolean;
  /** How often it taps the right symbol. Below 1 it starts missing, which is how a burn happens. */
  accuracy?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}) {
  const state = useRef({ heatId: "", acted: false });

  useEffect(() => {
    if (!input.enabled) return;
    let active = true;
    const accuracy = input.accuracy ?? 0.92;
    const minDelay = input.minDelayMs ?? 700;
    const maxDelay = input.maxDelayMs ?? 3_200;

    const tick = async () => {
      if (!active) return;
      try {
        const result = await readTwinSnapshotFn({
          data: {
            roomId: input.roomId,
            playerId: input.playerId,
            playerToken: input.playerToken,
          },
        });
        if (!active || !result.ok) return;
        const snapshot = result.snapshot;

        // Ready up so the host can start, exactly as the lobby button does.
        if (snapshot.phase === "lobby" && snapshot.player && !snapshot.player.ready) {
          await applyTwinActionFn({
            data: {
              roomId: input.roomId,
              playerId: input.playerId,
              playerToken: input.playerToken,
              action: { type: "readiness.set", ready: true },
            },
          });
          return;
        }

        const heat = snapshot.heat;
        const top = snapshot.player?.top;
        if (snapshot.phase !== "heat" || !heat || !top) return;
        if (state.current.heatId !== heat.id) state.current = { heatId: heat.id, acted: false };
        if (state.current.acted || snapshot.player?.landedMs !== null) return;

        const elapsed = Date.now() - heat.revealAt;
        const target = minDelay + (maxDelay - minDelay) * pseudoRandom(heat.id + input.playerId);
        if (elapsed < target) return;

        const middle = twinCardById(snapshot.order, heat.middle.cardId);
        const mine = twinCardById(snapshot.order, top.cardId);
        const answer = middle && mine ? twinMatch(mine, middle) : null;
        if (!answer) return;

        const wrong = top.symbolIds.find((id) => id !== answer) ?? answer;
        const symbolId = pseudoRandom(heat.id + input.playerId + "hit") < accuracy ? answer : wrong;
        state.current.acted = symbolId === answer;

        await applyTwinActionFn({
          data: {
            roomId: input.roomId,
            playerId: input.playerId,
            playerToken: input.playerToken,
            action: { type: "answer.tap", heatId: heat.id, symbolId, elapsedMs: elapsed },
          },
        });
      } catch {
        // A dev driver that stops on the first hiccup is worse than one that keeps trying.
      }
    };

    // Deliberately slower than it could be. Ten bots at 400ms is forty reads a second against a dev
    // server, which starves the real panels' own polling and makes the harness look like a bug in the
    // game. A bot that reacts a beat late costs nothing; a harness that lies costs an afternoon.
    const timer = window.setInterval(() => void tick(), 1_200);
    void tick();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    input.accuracy,
    input.enabled,
    input.maxDelayMs,
    input.minDelayMs,
    input.playerId,
    input.playerToken,
    input.roomId,
  ]);
}

/** Stable per heat and seat, so a bot's timing is reproducible within a run. */
function pseudoRandom(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
