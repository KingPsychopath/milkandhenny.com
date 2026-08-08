import { useState } from "react";
import type { ReactNode } from "react";
import { TWIN_MAX_HAND, TWIN_MIN_HAND, twinMaxPlayers } from "./twin-deck";
import { TWIN_SCENARIOS, type TwinScenario } from "./twin-scenarios";
import { TWIN_HEARTBEAT, TWIN_TIMING, type TwinHeartbeatTiming } from "./twin-rules";
import { applyTwinActionFn, createTwinRoomFn, joinTwinRoomFn } from "./twin-room.functions";
import { TwinRoom } from "./TwinRoomApp";
import { TwinDuelApp } from "./TwinDuelApp";
import { useTwinBot } from "./useTwinBot";
import { twinBrowserKeys } from "./twin-keys";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import type { TwinPlayerCredentials } from "./types";

/**
 * A whole table on one screen, for development only.
 *
 * Every panel is a real `TwinRoomApp` — the exact component a player gets on their phone, with its own
 * poll loop, its own wake socket and its own redacted snapshot. The harness does nothing a player could
 * not do; it only spares you ten phones and a stopwatch. Anything visible in a panel here is visible to
 * that player in the real game, which is the point: if a leak shows up on this screen, it is a real leak.
 *
 * Seat one is yours. The rest can be handed to bots (§useTwinBot) so a full game reaches its ending —
 * and its constellation — without ten pairs of hands.
 */
const NAMES = [
  "Abel",
  "Maya",
  "Daniel",
  "Priya",
  "Tom",
  "Ana",
  "Sam",
  "Ivy",
  "Leo",
  "Nina",
  "Otis",
  "Rue",
];

interface Seat extends TwinPlayerCredentials {
  name: string;
}

export function TwinDevHarness() {
  const [players, setPlayers] = useState(4);
  const [handSize, setHandSize] = useState(5);
  // Annotated because TWIN_TIMING is `as const`, so the initial value would infer as a literal.
  const [windowMs, setWindowMs] = useState<number>(TWIN_TIMING.defaultWindowMs);
  const [graceMs, setGraceMs] = useState<number>(TWIN_TIMING.defaultGraceMs);
  const [accuracy, setAccuracy] = useState(0.92);
  const [settleHoldMs, setSettleHoldMs] = useState<number>(TWIN_TIMING.settleHoldMs);
  const [connectionHoldMs, setConnectionHoldMs] = useState<number>(TWIN_TIMING.connectionHoldMs);
  const [heartbeatTiming, setHeartbeatTiming] = useState<TwinHeartbeatTiming>(TWIN_HEARTBEAT);
  const [duelPreview, setDuelPreview] = useState(false);
  const [bots, setBots] = useState(true);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (scenario?: TwinScenario) => {
    setBusy(true);
    setError(null);
    const count = scenario?.players ?? players;
    const hand = scenario?.handSize ?? handSize;
    const heatWindow = scenario?.windowMs ?? windowMs;
    const heatGrace = scenario?.graceMs ?? graceMs;
    if (scenario) {
      setPlayers(count);
      setHandSize(hand);
      setWindowMs(heatWindow);
      setGraceMs(heatGrace);
      if (scenario.botAccuracy !== undefined) setAccuracy(scenario.botAccuracy);
    }

    try {
      const created = await createTwinRoomFn({
        data: {
          hostName: NAMES[0],
          handSize: hand,
          windowMs: heatWindow,
          graceMs: heatGrace,
          settleHoldMs,
        },
      });
      // The host's own session, written the same way the real create flow writes it, so panel one
      // finds credentials instead of the join screen.
      writeExpiringLocalValue(
        twinBrowserKeys.playerSession(created.roomId),
        {
          roomId: created.roomId,
          playerId: created.playerId,
          playerToken: created.playerToken,
          expiresAt: created.expiresAt,
          snapshot: created.snapshot,
        },
        created.expiresAt,
      );
      sessionStorage.setItem(twinBrowserKeys.invite(created.roomId), created.joinToken);

      const joined: Seat[] = [
        {
          name: NAMES[0],
          roomId: created.roomId,
          playerId: created.playerId,
          playerToken: created.playerToken,
          expiresAt: created.expiresAt,
          snapshot: created.snapshot,
        },
      ];

      for (const name of NAMES.slice(1, count)) {
        const result = await joinTwinRoomFn({
          data: { roomId: created.roomId, joinToken: created.joinToken, name },
        });
        if (!result.ok) {
          setError(`${name}: ${result.error}`);
          continue;
        }
        joined.push({
          name,
          roomId: created.roomId,
          playerId: result.playerId,
          playerToken: result.playerToken,
          expiresAt: result.expiresAt,
          snapshot: result.snapshot,
        });
      }

      setSeats(joined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not open a room");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!seats) return;
    setBusy(true);
    try {
      const result = await applyTwinActionFn({
        data: {
          roomId: seats[0].roomId,
          playerId: seats[0].playerId,
          playerToken: seats[0].playerToken,
          action: { type: "game.start" },
        },
      });
      if (!result.ok || !result.accepted) setError(result.error ?? "could not start");
      else setError(null);
    } finally {
      setBusy(false);
    }
  };

  const tuneSettleHold = async (value: number) => {
    setSettleHoldMs(value);
    if (!seats) return;
    const result = await applyTwinActionFn({
      data: {
        roomId: seats[0].roomId,
        playerId: seats[0].playerId,
        playerToken: seats[0].playerToken,
        action: { type: "timing.configure", settleHoldMs: value },
      },
    });
    if (!result.ok || !result.accepted) setError(result.error ?? "could not tune the hold");
  };

  return (
    <div className="min-h-svh bg-black p-3">
      <header className="flex flex-wrap items-center gap-3 pb-3 font-mono text-xs text-white/70">
        <span className="font-bold uppercase tracking-[0.2em] text-[var(--things-amber)]">
          twin dev
        </span>
        <label className="flex items-center gap-2">
          result hold ms
          <input
            type="number"
            min={TWIN_TIMING.minSettleHoldMs}
            max={TWIN_TIMING.maxSettleHoldMs}
            step={100}
            value={settleHoldMs}
            onChange={(event) => void tuneSettleHold(Number(event.target.value))}
            className="w-20 border border-white/20 bg-transparent px-1 py-0.5"
          />
        </label>
        <label className="flex items-center gap-2">
          connection ms
          <input
            type="number"
            min={100}
            max={1_500}
            step={20}
            value={connectionHoldMs}
            onChange={(event) => setConnectionHoldMs(Number(event.target.value))}
            className="w-20 border border-white/20 bg-transparent px-1 py-0.5"
          />
        </label>
        <label className="flex items-center gap-2">
          heartbeat starts ms
          <input
            type="number"
            min={500}
            max={8_000}
            step={100}
            value={heartbeatTiming.startsAtMs}
            onChange={(event) =>
              setHeartbeatTiming((current) => ({
                ...current,
                startsAtMs: Number(event.target.value),
              }))
            }
            className="w-20 border border-white/20 bg-transparent px-1 py-0.5"
          />
        </label>
        <label className="flex items-center gap-2">
          beat slow / fast
          <input
            aria-label="Slowest heartbeat gap in milliseconds"
            type="number"
            min={200}
            max={1_200}
            step={10}
            value={heartbeatTiming.slowestGapMs}
            onChange={(event) =>
              setHeartbeatTiming((current) => ({
                ...current,
                slowestGapMs: Number(event.target.value),
              }))
            }
            className="w-16 border border-white/20 bg-transparent px-1 py-0.5"
          />
          /
          <input
            aria-label="Fastest heartbeat gap in milliseconds"
            type="number"
            min={100}
            max={800}
            step={10}
            value={heartbeatTiming.fastestGapMs}
            onChange={(event) =>
              setHeartbeatTiming((current) => ({
                ...current,
                fastestGapMs: Number(event.target.value),
              }))
            }
            className="w-16 border border-white/20 bg-transparent px-1 py-0.5"
          />
        </label>
        {seats ? (
          <>
            <span className="text-white/45">{seats[0]?.roomId}</span>
            <span className="text-white/35">
              every panel is the real player surface · seat one is yours
            </span>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              players
              <input
                type="number"
                min={1}
                max={twinMaxPlayers()}
                value={players}
                onChange={(event) => setPlayers(Number(event.target.value))}
                className="w-14 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-2">
              cards each
              <input
                type="number"
                min={TWIN_MIN_HAND}
                max={TWIN_MAX_HAND}
                value={handSize}
                onChange={(event) => setHandSize(Number(event.target.value))}
                className="w-14 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-2">
              window ms
              <input
                type="number"
                min={TWIN_TIMING.minWindowMs}
                max={TWIN_TIMING.maxWindowMs}
                step={500}
                value={windowMs}
                onChange={(event) => setWindowMs(Number(event.target.value))}
                className="w-20 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-2">
              grace ms
              <input
                type="number"
                min={TWIN_TIMING.minGraceMs}
                max={TWIN_TIMING.maxGraceMs}
                step={250}
                value={graceMs}
                onChange={(event) => setGraceMs(Number(event.target.value))}
                className="w-20 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={bots}
            onChange={(event) => setBots(event.target.checked)}
          />
          bots play the other seats
        </label>
        <label className="flex items-center gap-2">
          accuracy
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={accuracy}
            onChange={(event) => setAccuracy(Number(event.target.value))}
            className="w-16 border border-white/20 bg-transparent px-1 py-0.5"
          />
        </label>
        <span className="ml-auto flex gap-2">
          {!seats ? (
            <Chip onClick={() => setDuelPreview((current) => !current)}>
              {duelPreview ? "rooms" : "duel preview"}
            </Chip>
          ) : null}
          {seats ? (
            <>
              <Chip onClick={() => void start()} disabled={busy}>
                start game
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

      {error ? <p className="pb-2 font-mono text-xs text-red-400">{error}</p> : null}

      {duelPreview && !seats ? (
        <div className="mx-auto h-[780px] w-[375px] overflow-hidden border border-white/15">
          <TwinDuelApp onExit={() => setDuelPreview(false)} connectionHoldMs={connectionHoldMs} />
        </div>
      ) : seats ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {seats.map((seat, index) => (
            <div key={seat.playerId} className="shrink-0">
              <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                {seat.name}
                {index === 0 ? " · you · host" : bots ? " · bot" : ""}
              </p>
              {index > 0 ? <TwinBotSeat seat={seat} enabled={bots} accuracy={accuracy} /> : null}
              {/* Phone-sized and independently scrollable, so each panel behaves like its own device. */}
              <div className="h-[780px] w-[375px] overflow-y-auto border border-white/15">
                <TwinRoom
                  roomId={seat.roomId}
                  credentials={seat}
                  heartbeatTiming={heartbeatTiming}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="max-w-xl font-mono text-xs leading-relaxed text-white/45">
            Opens a real room, joins {players} players, and mounts the real player surface for each
            of them side by side — same server functions, same polling, same redactions as separate
            phones.
          </p>

          <section className="mt-6 max-w-3xl border-t border-white/15 pt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              start from a position
            </p>
            <p className="mt-1 font-mono text-xs text-white/35">
              The awkward corners of the rules, each one tap rather than a lucky shuffle. The same
              list is walked by the integration tests.
            </p>
            <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {TWIN_SCENARIOS.map((scenario) => (
                <li key={scenario.id} className="border-t border-white/10 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void open(scenario)}
                    className="w-full text-left disabled:opacity-40"
                  >
                    <span className="flex items-baseline gap-2 font-mono text-xs">
                      <span className="text-white/80">{scenario.name}</span>
                      <span className="ml-auto text-white/25">
                        {scenario.players}p · {scenario.handSize} cards
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
        </>
      )}
    </div>
  );
}

function TwinBotSeat({
  seat,
  enabled,
  accuracy,
}: {
  seat: Seat;
  enabled: boolean;
  accuracy: number;
}) {
  useTwinBot({
    roomId: seat.roomId,
    playerId: seat.playerId,
    playerToken: seat.playerToken,
    enabled,
    accuracy,
  });
  return null;
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
