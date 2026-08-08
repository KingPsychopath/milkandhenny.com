import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LIARS_MODE_COPY, LIARS_PLAYER_LIMITS } from "./liars-rules";
import {
  createLiarsRoomFn,
  exportLiarsRoomFn,
  importLiarsRoomFn,
  joinLiarsRoomFn,
  startLiarsScenarioFn,
} from "./liars-room.functions";
import { LIARS_SCENARIOS, type LiarsScenario } from "./liars-scenarios";
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

const CAPTURES_KEY = "things:liars:v1:dev-captures";

interface Capture {
  label: string;
  savedAt: number;
  payload: unknown;
}

function readCaptures(): Capture[] {
  try {
    return JSON.parse(localStorage.getItem(CAPTURES_KEY) ?? "[]") as Capture[];
  } catch {
    return [];
  }
}

export function LiarsDevHarness() {
  const [mode, setMode] = useState<LiarsMode>("mafia");
  const [count, setCount] = useState(9);
  const [fast, setFast] = useState(true);
  const [seats, setSeats] = useState<LiarsPlayerCredentials[] | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCaptures(readCaptures()), []);

  const writeCaptures = (next: Capture[]) => {
    setCaptures(next);
    try {
      localStorage.setItem(CAPTURES_KEY, JSON.stringify(next));
    } catch {
      setError("capture too large for local storage — download it instead");
    }
  };

  /**
   * Freezes the room exactly as it stands, tokens and all, so a scenario worth returning to does
   * not have to be replayed from the lobby every time. Restoring writes it back under a new id, so
   * the same capture can be reloaded as often as you like.
   */
  const capture = async () => {
    if (!seats || !hostToken) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await exportLiarsRoomFn({
        data: {
          roomId: seats[0].roomId,
          hostToken,
          seats: seats.map((seat, index) => ({
            name: names[index] ?? NAMES[index],
            playerId: seat.playerId,
            playerToken: seat.playerToken,
          })),
        },
      });
      if (!payload) {
        setError("could not capture that room");
        return;
      }
      const label = window.prompt("name this scenario", `${mode} · ${new Date().toLocaleTimeString()}`);
      if (!label) return;
      writeCaptures([{ label, savedAt: Date.now(), payload }, ...captures].slice(0, 24));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry: Capture) => {
    setBusy(true);
    setError(null);
    try {
      const restored = await importLiarsRoomFn({ data: { snapshot: entry.payload } });
      if (!restored) {
        setError("that capture could not be restored");
        return;
      }
      setHostToken(restored.hostToken);
      setNames(restored.seats.map(({ name }) => name));
      setSeats(
        restored.seats.map((seat) => ({
          roomId: restored.roomId,
          playerId: seat.playerId,
          playerToken: seat.playerToken,
          expiresAt: Date.now() + 60 * 60_000,
          snapshot: undefined as never,
        })),
      );
    } catch {
      setError("that capture could not be restored");
    } finally {
      setBusy(false);
    }
  };

  const download = (entry: Capture) => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `liars-${entry.label.replace(/\W+/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    try {
      const entry = JSON.parse(await file.text()) as Capture;
      writeCaptures([entry, ...captures].slice(0, 24));
    } catch {
      setError("that file is not a capture");
    }
  };

  /** Opens straight into a named position, already dealt, rather than from an empty lobby. */
  const openScenario = async (scenario: LiarsScenario) => {
    setBusy(true);
    setError(null);
    try {
      const started = await startLiarsScenarioFn({
        data: {
          mode: scenario.mode,
          names: NAMES.slice(0, scenario.players),
          lineup: scenario.lineup,
          toggles: scenario.toggles,
          deal: scenario.deal,
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
      if (started.error) {
        setError(started.error);
        return;
      }
      setMode(scenario.mode);
      setHostToken(started.hostToken);
      setNames(started.seats.map(({ name }) => name));
      setSeats(
        started.seats.map((seat) => ({
          roomId: started.roomId,
          playerId: seat.playerId,
          playerToken: seat.playerToken,
          expiresAt: Date.now() + 60 * 60_000,
          snapshot: undefined as never,
        })),
      );
    } catch {
      setError("could not open that scenario");
    } finally {
      setBusy(false);
    }
  };

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
      setHostToken(created.hostToken);
      setNames(NAMES.slice(0, count));
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
            <>
              <Chip onClick={() => void capture()} disabled={busy}>
                capture
              </Chip>
              <Chip onClick={() => setSeats(null)}>reset</Chip>
            </>
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
        <>
          <p className="max-w-xl font-mono text-xs leading-relaxed text-white/45">
            Opens a real room, joins {count} players, and mounts the real player surface for each of
            them side by side — same server functions, same polling, same redactions as separate
            phones. {LIARS_MODE_COPY[mode].tagline}
          </p>

          <section className="mt-6 max-w-3xl border-t border-white/15 pt-4">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
              start from a position
            </p>
            <p className="mt-1 font-mono text-xs text-white/35">
              Already dealt, so the awkward corners of the rules are one tap rather than a lucky
              shuffle. The same list is walked by the integration tests.
            </p>
            <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {LIARS_SCENARIOS.map((scenario) => (
                <li key={scenario.id} className="border-t border-white/10 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openScenario(scenario)}
                    className="w-full text-left disabled:opacity-40"
                  >
                    <span className="flex items-baseline gap-2 font-mono text-xs">
                      <span className="text-white/80">{scenario.name}</span>
                      <span className="ml-auto text-white/25">
                        {scenario.mode} · {scenario.players}
                      </span>
                    </span>
                    <span className="mt-1 block font-mono text-xs leading-relaxed text-white/35">
                      {scenario.about}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 max-w-xl border-t border-white/15 pt-4">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
              saved scenarios
            </p>
            <p className="mt-1 font-mono text-xs text-white/35">
              Capture a room mid-game and come back to it whenever, instead of replaying three
              rounds to reach the state you wanted to look at.
            </p>
            <ul className="mt-3">
              {captures.length === 0 ? (
                <li className="py-2 font-mono text-xs text-white/30">nothing saved yet</li>
              ) : (
                captures.map((entry) => (
                  <li
                    key={`${entry.label}-${entry.savedAt}`}
                    className="flex items-center gap-3 border-t border-white/10 py-2 font-mono text-xs"
                  >
                    <span className="text-white/70">{entry.label}</span>
                    <span className="text-white/25">
                      {new Date(entry.savedAt).toLocaleString()}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Chip onClick={() => void restore(entry)} disabled={busy}>
                        restore
                      </Chip>
                      <Chip onClick={() => download(entry)}>download</Chip>
                      <Chip
                        onClick={() =>
                          writeCaptures(captures.filter((each) => each.savedAt !== entry.savedAt))
                        }
                      >
                        delete
                      </Chip>
                    </span>
                  </li>
                ))
              )}
            </ul>
            <label className="mt-3 inline-flex min-h-8 cursor-pointer items-center border border-white/25 px-3 font-mono text-xs text-white/80 hover:border-[var(--things-amber)]">
              load a capture file
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
          </section>
        </>
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
