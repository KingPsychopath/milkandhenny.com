import { useEffect, useState } from "react";
import type { LiarsSnapshot } from "./types";

/**
 * The village.
 *
 * It shows **only what is already public**, and that constraint is the whole design rather than a
 * limitation of it. A village whose windows lit when people actually acted would be a global
 * movement display, and movement being local — one watcher learning one bit about one person they
 * chose — is the single thing holding the watch mechanic up. Every window lighting on every device
 * would make villagers pointless and the mafia visible on night one.
 *
 * The near miss is worse than the obvious one: lights that correlate with nothing at all. People
 * read meaning into anything that moves, and a table can lose a whole day to a lamp that meant
 * nothing. False signal in a deduction game is damage, not decoration.
 *
 * So: at night the village is anonymous and the lit windows are exactly the public count. At dawn
 * it is named, and it does what the narration is already saying.
 */
interface VillageProps {
  snapshot: LiarsSnapshot;
  clockOffset: number;
}

/** Stable per round, so nobody can build a house-to-person map across a game. */
export function liarsVillageOrder(count: number, seed: number) {
  const order = Array.from({ length: count }, (_, index) => index);
  let value = seed * 9301 + 49297;
  for (let index = order.length - 1; index > 0; index -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const swap = Math.floor((value / 233280) * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

export type LiarsHouseState = "dark" | "lit" | "dead" | "dying" | "saved" | "moved";

/**
 * What one house is doing, given only public state. Pure and exported so the dawn beats can be
 * tested against a clock rather than caught by eye inside an eight-second window.
 */
export function liarsHouseState(input: {
  player: { id: string; name: string; alive: boolean };
  phase: LiarsSnapshot["phase"];
  dawn: LiarsSnapshot["dawn"];
  night: boolean;
  isLitAtNight: boolean;
  landed: boolean;
  revived: boolean;
}): LiarsHouseState {
  const { player, dawn, night, landed } = input;
  if (night) return input.isLitAtNight ? "lit" : "dark";

  // Order matters, and getting it wrong is invisible in a screenshot. The server marks somebody
  // dead the moment the night resolves, so both of the checks below have to come before the plain
  // alive/dead one — otherwise a death shutters instantly and the whole dawn beat never plays.
  if (dawn && !landed) return "lit";

  if (dawn && landed) {
    const death = dawn.deaths.find(({ playerId }) => playerId === player.id);
    if (death?.revived) return input.revived ? "saved" : "dying";
    if (death) return "dying";
    if (dawn.movementSeen.includes(player.name)) return "moved";
  }

  return player.alive ? "lit" : "dead";
}

export function LiarsVillage({ snapshot, clockOffset }: VillageProps) {
  const [, setTick] = useState(0);
  const dawn = snapshot.dawn;
  const night = snapshot.phase === "night";

  // Redraws through the dawn beats, which are timestamps rather than events.
  useEffect(() => {
    if (snapshot.phase !== "dawn") return;
    const timer = window.setInterval(() => setTick((count) => count + 1), 250);
    return () => window.clearInterval(timer);
  }, [snapshot.phase]);

  const players = snapshot.players;
  if (players.length === 0) return null;

  const now = Date.now() + clockOffset;
  const landed = dawn ? now >= dawn.nameLandsAt : false;
  const revived = dawn?.reviveAt != null ? now >= dawn.reviveAt : false;

  // At night the windows are the public count and nothing more, at positions that move each round.
  const litPositions = new Set(
    night ? liarsVillageOrder(players.length, snapshot.round).slice(0, snapshot.actedCount) : [],
  );

  const stateOf = (index: number) =>
    liarsHouseState({
      player: players[index],
      phase: snapshot.phase,
      dawn,
      night,
      isLitAtNight: litPositions.has(index),
      landed,
      revived,
    });

  const columns = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(players.length * 1.6))));

  return (
    <section
      className="mt-6"
      aria-label={night ? "the village at night" : "the village"}
      // The village repeats what the text already says; screen readers get it once, not twice.
      aria-hidden="true"
    >
      <ul
        className="grid gap-x-2 gap-y-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {players.map((player, index) => {
          const state = stateOf(index);
          return (
            <li key={player.id} className="flex flex-col items-center">
              <House state={state} />
              {!night ? (
                <span
                  className={`mt-1 truncate font-mono text-micro ${
                    state === "dead" ? "text-white/20 line-through" : "text-white/45"
                  }`}
                  style={{ maxWidth: "100%" }}
                >
                  {player.name}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {night ? (
        <p className="mt-3 text-center font-mono text-micro text-white/25">
          a light for everyone who has acted · not whose
        </p>
      ) : null}
    </section>
  );
}

const WINDOW_FILL: Record<LiarsHouseState, string> = {
  dark: "var(--liars-house-dark)",
  lit: "var(--things-amber)",
  moved: "var(--things-amber)",
  dying: "var(--liars-dead)",
  saved: "var(--liars-alive)",
  dead: "var(--liars-house-dark)",
};

function House({ state }: { state: LiarsHouseState }) {
  const roof = state === "dead" ? "var(--liars-house-dark)" : "var(--liars-house-roof)";
  return (
    <svg viewBox="0 0 40 44" className="w-full max-w-12" role="presentation">
      {/* Roof and walls stay flat and quiet; the window is the only thing that ever speaks. */}
      <path d="M20 4 L37 17 L3 17 Z" fill={roof} />
      <rect x="6" y="17" width="28" height="24" rx="1.5" fill="var(--liars-house-wall)" />
      <rect
        x="14"
        y="23"
        width="12"
        height="11"
        rx="1"
        fill={WINDOW_FILL[state]}
        className={
          state === "moved"
            ? "liars-window--moved"
            : state === "dying"
              ? "liars-window--dying"
              : state === "saved"
                ? "liars-window--saved"
                : "liars-window"
        }
      />
      {state === "dead" ? (
        <path d="M12 21 L28 36 M28 21 L12 36" stroke="var(--liars-house-roof)" strokeWidth="1.6" />
      ) : null}
    </svg>
  );
}
