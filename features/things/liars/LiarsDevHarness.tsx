import { useState } from "react";
import type { ReactNode } from "react";
import { LIARS_MODE_COPY, LIARS_PLAYER_LIMITS } from "./liars-rules";
import { createLiarsRoomFn, joinLiarsRoomFn } from "./liars-room.functions";
import { LiarsRoom } from "./LiarsRoomApp";
import type { LiarsMode, LiarsPlayerCredentials } from "./types";

/**
 * A whole table on one screen, for development only.
 *
 * Every panel is a real `LiarsRoom` — the exact component a player gets on their phone, with its
 * own poll loop, its own wake socket and its own redacted snapshot. The harness does nothing a
 * player could not do; it only spares you five phones and a stopwatch. Anything visible in a panel
 * here is visible to that player in the real game, which is the whole point: if a leak shows up on
 * this screen, it is a real leak.
 */
const NAMES = [
  "Abel", "Maya", "Daniel", "Priya", "Tom", "Ana", "Sam", "Ivy",
  "Leo", "Nina", "Otis", "Rue", "Sol", "Vic", "Wren", "Zaid",
];

export function LiarsDevHarness() {
  const [mode, setMode] = useState<LiarsMode>("mafia");
  const [count, setCount] = useState(9);
  const [fast, setFast] = useState(true);
  const [seats, setSeats] = useState<LiarsPlayerCredentials[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createLiarsRoomFn({
        data: {
          mode,
          roomMode: "same-room",
          // Short enough to iterate on, but the night keeps room ahead of the T−10s report for a
          // whole table to act. Off, it runs at the real timings.
          ...(fast
            ? {
                timings: {
                  deal: 10_000,
                  night: 45_000,
                  dawn: 8_000,
                  deliberation: 20_000,
                  vote: 10_000,
                  verdict: 5_000,
                },
              }
            : {}),
        },
      });
      const joined: LiarsPlayerCredentials[] = [];
      for (const name of NAMES.slice(0, count)) {
        const result = await joinLiarsRoomFn({
          data: {
            roomId: created.roomId,
            joinToken: created.joinToken,
            name,
            joinId: `dev-${created.roomId}-${name}`,
          },
        });
        if (!result.ok) {
          setError(`${name}: ${result.error}`);
          continue;
        }
        joined.push({
          roomId: created.roomId,
          playerId: result.playerId,
          playerToken: result.playerToken,
          expiresAt: result.expiresAt,
          snapshot: result.snapshot,
        });
      }
      setSeats(joined);
    } catch {
      setError("could not open a room");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-svh bg-black p-3">
      <header className="flex flex-wrap items-center gap-3 pb-3 font-mono text-xs text-white/70">
        <span className="font-bold uppercase tracking-[0.2em] text-[var(--things-amber)]">
          liars dev
        </span>
        {seats ? (
          <>
            <span className="text-white/45">{seats[0]?.roomId}</span>
            <span className="text-white/35">
              every panel is the real player surface · drive them exactly as a player would
            </span>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              mode
              <select
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as LiarsMode;
                  setMode(next);
                  setCount((current) =>
                    Math.min(
                      LIARS_PLAYER_LIMITS[next].max,
                      Math.max(LIARS_PLAYER_LIMITS[next].min, current),
                    ),
                  );
                }}
                className="border border-white/20 bg-transparent px-1 py-0.5"
              >
                <option value="mafia">mafia</option>
                <option value="imposter">imposter</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              players
              <input
                type="number"
                min={LIARS_PLAYER_LIMITS[mode].min}
                max={LIARS_PLAYER_LIMITS[mode].max}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-14 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fast}
                onChange={(event) => setFast(event.target.checked)}
              />
              short phases
            </label>
          </>
        )}
        <span className="ml-auto flex gap-2">
          {seats ? (
            <Chip onClick={() => setSeats(null)}>reset</Chip>
          ) : (
            <Chip onClick={() => void open()} disabled={busy}>
              {busy ? "opening…" : "open room"}
            </Chip>
          )}
        </span>
      </header>

      {error ? <p className="pb-2 font-mono text-xs text-[var(--liars-dead)]">{error}</p> : null}

      {seats ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {seats.map((credentials, index) => (
            <div key={credentials.playerId} className="shrink-0">
              <p className="pb-1 font-mono text-micro uppercase tracking-[0.16em] text-white/40">
                {NAMES[index]}
                {index === 0 ? " · host" : ""}
              </p>
              {/* Phone-sized and independently scrollable, so each panel behaves like its own device. */}
              <div className="h-[780px] w-[375px] overflow-y-auto border border-white/15">
                <LiarsRoom credentials={credentials} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="max-w-xl font-mono text-xs leading-relaxed text-white/45">
          Opens a real room, joins {count} players, and mounts the real player surface for each of
          them side by side — same server functions, same polling, same redactions as separate
          phones. {LIARS_MODE_COPY[mode].tagline}
        </p>
      )}
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-8 border border-white/25 px-3 font-mono text-xs text-white/80 hover:border-[var(--things-amber)] hover:text-[var(--things-amber)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
