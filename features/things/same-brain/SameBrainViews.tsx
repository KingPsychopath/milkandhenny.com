import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SameBrainRoundResult, SameBrainSnapshot } from "./types";

/**
 * Accessible countdown: the bar is decoration, the text is the information.
 *
 * While paused it says so instead of showing a frozen clock. A number that has stopped moving reads
 * as a bug, and the one thing a paused room must not look like is a broken one.
 */
export function PhaseTimer({
  endsAt,
  clockOffset,
  label,
  big,
  paused,
}: {
  endsAt: number;
  clockOffset: number;
  label: string;
  big?: boolean;
  paused?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 250);
    return () => window.clearInterval(timer);
  }, [clockOffset, paused]);

  if (endsAt === 0) return null;
  if (paused)
    return (
      <p className="mt-2 font-mono text-micro uppercase tracking-[0.18em] text-[var(--things-amber)]">
        paused by the host
      </p>
    );
  const remaining = Math.max(0, endsAt - now);
  const seconds = Math.ceil(remaining / 1_000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (big)
    return (
      <p className="mt-2 flex items-baseline gap-3" aria-live="off">
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">
          {label}
        </span>
        <span
          className={`font-mono text-3xl font-bold tabular-nums ${
            remaining <= 10_000 ? "text-[var(--things-amber)]" : "text-white/70"
          }`}
        >
          {clock}
        </span>
      </p>
    );

  return (
    // No separate screen-reader label: the visible text already names the phase, and duplicating it
    // makes assistive tech read "next round: next round · 01:54".
    <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45" aria-live="off">
      {label} · {clock}
    </p>
  );
}

/**
 * The spoken beat: every phone counts down to the same moment, then shows its owner their own word.
 *
 * Synchronisation is the whole feature, so nothing here is timed from mount. `endsAt` is a server
 * timestamp and `clockOffset` is this device's measured drift, which is the same mechanism the liars
 * dawn uses to land a beat on six phones at once. Timing from a local `setTimeout` would drift by
 * however long each phone took to poll, and a countdown that reaches zero at six different moments
 * produces exactly the staggered reading the beat exists to prevent.
 *
 * The word is shown throughout the countdown, not at the end of it — see
 * `SAME_BRAIN_SAY_IT_HOLD_MS` for why that ordering is the difference between a room speaking at
 * once and a room speaking in turn.
 *
 * `word` is only ever your own. Nobody else's is in the snapshot yet.
 */
export function SayItBeat({
  endsAt,
  holdMs,
  clockOffset,
  word,
}: {
  endsAt: number;
  holdMs: number;
  clockOffset: number;
  word: string | null;
}) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    // 100ms, not 250: at a quarter second the "1" can visibly sit for two frames past its turn.
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 100);
    return () => window.clearInterval(timer);
  }, [clockOffset]);

  const sayAt = endsAt - holdMs;
  const counting = now < sayAt;
  const count = Math.max(1, Math.ceil((sayAt - now) / 1_000));

  if (!word)
    return (
      <div className="mt-10 text-center">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">
          {counting ? "everybody else, get ready" : "listen"}
        </p>
        <p className="mt-4 font-serif text-2xl text-white/50">You did not answer this one.</p>
      </div>
    );

  return (
    <div className="mt-10 text-center">
      <p
        className={`font-mono text-micro uppercase tracking-[0.2em] ${
          counting ? "text-white/40" : "text-[var(--things-amber)]"
        }`}
      >
        {counting ? "say this together on zero" : "now — all together"}
      </p>
      {/*
        Your word, up for the whole beat rather than sprung at the end: you cannot land on the same
        instant as five other people while still reading. Big enough to read at arm's length and to
        hold up across a table.
      */}
      <p
        className={`mt-4 font-serif font-semibold leading-tight transition-colors ${
          counting ? "text-5xl text-white/85" : "text-6xl text-[var(--things-amber)]"
        }`}
      >
        {word}
      </p>
      {counting ? (
        <p
          key={count}
          className="mt-6 font-serif text-7xl font-semibold tabular-nums text-white/30"
          aria-hidden="true"
        >
          {count}
        </p>
      ) : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">{children}</p>
  );
}

export function Headline({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
      {children}
    </h1>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = "amber",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "amber" | "quiet";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        tone === "amber"
          ? "min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black transition-transform hover:scale-[1.01] disabled:scale-100 disabled:opacity-40"
          : "min-h-12 w-full rounded-full border border-white/25 px-7 font-mono text-xs text-white/80 hover:border-white/50 disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}

/**
 * The scoreboard. Sorted by score, and it shows `aloneCount` even when the elimination rule is off —
 * being the only person who thought that is the running joke of the game, and a group will keep
 * their own tally out loud whether or not the app does.
 */
export function Scoreboard({
  snapshot,
  highlightIds = [],
}: {
  snapshot: SameBrainSnapshot;
  highlightIds?: string[];
}) {
  const ranked = [...snapshot.players].sort((left, right) => right.score - left.score);
  return (
    <ul className="mt-4">
      {ranked.map((player) => (
        <li
          key={player.id}
          className={`flex min-h-11 items-center gap-3 border-t border-white/10 font-mono text-sm ${
            player.out ? "opacity-35" : ""
          }`}
        >
          <span
            className={
              highlightIds.includes(player.id) ? "text-[var(--things-amber)]" : "text-white/80"
            }
          >
            {player.name}
          </span>
          {player.host ? <span className="text-micro text-white/30">host</span> : null}
          {player.out ? <span className="text-micro text-white/40">out</span> : null}
          {!player.connected ? (
            <span className="text-micro text-white/30" title="not connected">
              ◌
            </span>
          ) : null}
          {player.aloneCount > 0 ? (
            <span className="text-micro text-white/35">{player.aloneCount}× alone</span>
          ) : null}
          <span className="ml-auto tabular-nums text-white/70">{player.score}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reveal.
 *
 * Groups are drawn largest first with the herd marked, because the shape of the room is the joke and
 * the points are the footnote. Two rules about what is *not* here: no similarity number is ever
 * shown to a player — "0.71" is not a reason and invites an argument with a decimal — and the model
 * only ever appears as a plain sentence about words it merged, which the group is free to overrule
 * out loud. That is the whole of its authority.
 */
export function RevealBoard({
  result,
  snapshot,
  onMerge,
}: {
  result: SameBrainRoundResult;
  snapshot: SameBrainSnapshot;
  /**
   * Host only. Folds one group into another and re-scores — how a typo, a regional word or anything
   * the scorer misread gets fixed by the people who heard what was meant.
   */
  onMerge?: (from: number, to: number) => void;
}) {
  const nameOf = (playerId: string) =>
    snapshot.players.find(({ id }) => id === playerId)?.name ?? "someone";
  // The original index is what a merge refers to, so it has to survive the display sort.
  const groups = result.clusters
    .map((cluster, index) => ({ cluster, index, isHerd: index === result.herdIndex }))
    .sort(
      (left, right) =>
        Number(right.isHerd) - Number(left.isHerd) ||
        right.cluster.playerIds.length - left.cluster.playerIds.length,
    );
  const odd = result.oddPlayerId ? nameOf(result.oddPlayerId) : null;
  /**
   * What a corrected group joins. The herd when there is one; otherwise the biggest group, so a room
   * that split two-and-two can be resolved by saying those two answers were the same thing.
   */
  const mergeTarget = result.herdIndex ?? groups[0]?.index ?? null;

  return (
    <div className="mt-6">
      {result.herdIndex === null ? (
        <p className="font-serif text-2xl text-white/85">
          {result.answers.length === 0
            ? "Nobody answered."
            : result.clusters.every(({ playerIds }) => playerIds.length === 1)
              ? "No two of you agreed on anything. Nobody scores."
              : "The room split. Nobody scores."}
        </p>
      ) : (
        <p className="font-serif text-2xl text-white/85">
          {result.pointsEach} {result.pointsEach === 1 ? "point" : "points"} each to the{" "}
          {result.clusters[result.herdIndex].playerIds.length} of you who said{" "}
          <span className="text-[var(--things-amber)]">
            {result.clusters[result.herdIndex].label}
          </span>
          .
        </p>
      )}

      {result.pointsEach === 1 && result.herdIndex !== null ? (
        <p className="mt-2 font-mono text-xs text-white/40">
          Everybody said the same thing, so it is worth one instead of two.
        </p>
      ) : null}

      <ul className="mt-5">
        {groups.map(({ cluster, index, isHerd }) => (
          <li
            key={cluster.label + cluster.playerIds.join()}
            className="border-t border-white/10 py-3"
          >
            <p className="flex items-baseline gap-2">
              <span
                className={`font-serif text-xl ${
                  isHerd ? "text-[var(--things-amber)]" : "text-white/70"
                }`}
              >
                {cluster.label}
              </span>
              {onMerge && mergeTarget !== null && index !== mergeTarget ? (
                <button
                  type="button"
                  onClick={() => onMerge(index, mergeTarget)}
                  className="min-h-8 border border-white/20 px-2 font-mono text-micro text-white/50 hover:border-[var(--things-amber)] hover:text-[var(--things-amber)]"
                >
                  same as {result.clusters[mergeTarget].label}
                </button>
              ) : null}
              <span className="ml-auto font-mono text-xs text-white/35">
                {cluster.playerIds.length}
              </span>
            </p>
            {snapshot.toggles.revealAuthors ? (
              <p className="mt-1 font-mono text-xs text-white/45">
                {cluster.playerIds
                  .map((playerId) => {
                    const written = result.answers.find(
                      (answer) => answer.playerId === playerId,
                    )?.text;
                    // Their own spelling matters when the group merged several: "Sam said ocean"
                    // is the interesting fact, not that Sam is in the sea group.
                    return written && written.toLocaleLowerCase() !== cluster.label
                      ? `${nameOf(playerId)} (${written})`
                      : nameOf(playerId);
                  })
                  .join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {odd ? (
        <p className="mt-4 font-mono text-xs text-white/55">
          {odd} was the only one.
          {snapshot.toggles.eliminateOddOne ? " They are out." : ""}
        </p>
      ) : null}

      {result.corrected ? (
        <p className="mt-4 font-mono text-xs text-white/40">the room corrected this one.</p>
      ) : null}

      {snapshot.toggles.showMachineWorking && result.machineNote ? (
        <p className="mt-4 border-t border-white/10 pt-3 font-mono text-xs text-white/40">
          the machine thought: {result.machineNote}
        </p>
      ) : null}
    </div>
  );
}
