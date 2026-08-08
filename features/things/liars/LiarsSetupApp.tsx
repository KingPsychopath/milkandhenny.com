import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GameLaunch, GameLaunchButton, GameLaunchMeta } from "../shared/GameLaunch";
import { GameShell } from "../shared/GameShell";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { liarsBrowserKeys } from "./liars-keys";
import { LIARS_MODE_COPY, LIARS_PLAYER_LIMITS, liarsDefaultLineup } from "./liars-rules";
import { createLiarsRoomFn } from "./liars-room.functions";
import { liarsPlayerPath } from "./liars-invite";
import { LineupBoard } from "./LiarsViews";
import {
  liarsTorchAdvice,
  liarsTorchState,
  requestLiarsTorch,
  type LiarsTorchState,
} from "./torch.client";
import type { LiarsMode, LiarsRoomMode, LiarsToggles } from "./types";

const MODES: Array<{ id: LiarsMode; title: string; blurb: string }> = [
  {
    id: "mafia",
    title: "mafia",
    blurb: "Someone here is killing people at night. Find them before they run out of people.",
  },
  {
    id: "imposter",
    title: "imposter",
    blurb: "Everyone knows the word except one of you. Say a clue. Don't be the one they catch.",
  },
];

export function LiarsSetupApp() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LiarsMode>("mafia");
  const [roomMode, setRoomMode] = useState<LiarsRoomMode>("same-room");
  const [firstGame, setFirstGame] = useState(false);
  const [torch, setTorch] = useState(false);
  const [expected, setExpected] = useState(9);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [showRoles, setShowRoles] = useState(false);

  const limits = LIARS_PLAYER_LIMITS[mode];
  const players = Math.min(limits.max, Math.max(limits.min, expected));

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const toggles: Partial<LiarsToggles> = { firstGame, cameraTorch: torch };
      const room = await createLiarsRoomFn({ data: { mode, roomMode, toggles } });
      writeExpiringLocalValue(
        liarsBrowserKeys.hostSession(room.roomId),
        { hostToken: room.hostToken, joinToken: room.joinToken },
        room.expiresAt,
      );
      sessionStorage.setItem(liarsBrowserKeys.invite(room.roomId), room.joinToken);
      await navigate({ to: liarsPlayerPath(room.roomId) });
    } catch {
      setMessage("Could not open a room. Check your connection and try again.");
      setCreating(false);
    }
  };

  return (
    <GameShell tone="night">
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-16 text-white">
        <GameLaunch
          tone="night"
          eyebrow="social deduction · 4–16 people"
          title="liars"
          description="Two games, one room. Everyone gets something to do every single round, and the phone handles all of the bookkeeping so you can argue."
        >
          <div className="space-y-3">
            {MODES.map((option) => {
              const selected = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setMode(option.id);
                    setExpected((current) =>
                      Math.min(
                        LIARS_PLAYER_LIMITS[option.id].max,
                        Math.max(LIARS_PLAYER_LIMITS[option.id].min, current),
                      ),
                    );
                  }}
                  className={`w-full border-t border-white/15 py-4 text-left transition-opacity ${
                    selected ? "" : "opacity-45 hover:opacity-75"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`h-6 w-0.5 rounded-full ${
                        selected ? "bg-[var(--things-amber)]" : "bg-transparent"
                      }`}
                    />
                    <span className="font-serif text-2xl">{option.title}</span>
                    <span className="ml-auto font-mono text-micro uppercase tracking-[0.16em] text-white/40">
                      {LIARS_PLAYER_LIMITS[option.id].min}–{LIARS_PLAYER_LIMITS[option.id].max}
                    </span>
                  </span>
                  <span className="mt-2 block pl-3.5 font-serif text-sm text-white/60">
                    {option.blurb}
                  </span>
                </button>
              );
            })}

            <div className="border-t border-white/15 pt-5">
              <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                where is everyone
              </p>
              <div className="mt-3 flex gap-2">
                {(["same-room", "remote"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={roomMode === option}
                    onClick={() => setRoomMode(option)}
                    className={`min-h-11 flex-1 rounded-full border px-4 font-mono text-xs ${
                      roomMode === option
                        ? "border-[var(--things-amber)] text-[var(--things-amber)]"
                        : "border-white/20 text-white/55"
                    }`}
                  >
                    {option === "same-room" ? "same room" : "on a call"}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-xs text-white/35">
                {roomMode === "same-room"
                  ? "one device narrates, so eight phones don't echo"
                  : "every device narrates, and the discussion gets longer"}
              </p>
            </div>

            <label className="flex min-h-11 items-center gap-3 border-t border-white/15 pt-5 font-mono text-xs text-white/60">
              <input
                type="checkbox"
                checked={firstGame}
                onChange={(event) => setFirstGame(event.target.checked)}
                className="size-4 accent-[var(--things-amber)]"
              />
              nobody here has played before
            </label>
            {firstGame ? (
              <p className="font-mono text-xs text-white/35">
                doctor, detective and villagers only, and a longer look at your role
              </p>
            ) : null}

            <TorchToggle enabled={torch} onChange={setTorch} />

            <div className="border-t border-white/15 pt-5">
              <label className="font-mono text-xs text-white/55">
                <span className="block pb-2">
                  roughly how many of you · {players}
                </span>
                <input
                  type="range"
                  min={limits.min}
                  max={limits.max}
                  value={players}
                  onChange={(event) => setExpected(Number(event.target.value))}
                  className="w-full accent-[var(--things-amber)]"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowRoles(!showRoles)}
                aria-expanded={showRoles}
                className="mt-3 min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
              >
                {showRoles ? "hide the roles" : "what roles is that"}
              </button>
              {showRoles ? (
                <div className="mt-3">
                  <LineupBoard
                    mode={mode}
                    lineup={liarsDefaultLineup(mode, players)}
                    playerCount={players}
                  />
                  <p className="mt-3 font-mono text-xs text-white/35">
                    the lineup follows the room as people join, and the host can change it before
                    the deal
                  </p>
                </div>
              ) : null}
            </div>

            <div className="pt-2">
              <GameLaunchButton accent="amber" disabled={creating} onClick={() => void handleCreate()}>
                {creating ? "opening…" : `open a ${LIARS_MODE_COPY[mode].name} room`}
              </GameLaunchButton>
              <GameLaunchMeta tone="dark">
                you play too · everyone joins with the room code
              </GameLaunchMeta>
            </div>

            <div className="border-t border-white/15 pt-5">
              <RoomJoinControl
                value={joinCode}
                gamePath="things/liars"
                tone="dark"
                message={message}
                onValueChange={setJoinCode}
                onJoin={(code) => navigate({ to: liarsPlayerPath(code) })}
              />
            </div>
          </div>
        </GameLaunch>
      </div>
    </GameShell>
  );
}

/**
 * The only permission the game asks for. It asks here, on a deliberate tap with the reason on
 * screen, rather than in the middle of somebody's death — and it says out loud when the browser
 * has refused, because a browser will not prompt twice and a silently dead toggle is worse than
 * no toggle at all.
 */
function TorchToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const [state, setState] = useState<LiarsTorchState | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void liarsTorchState().then(setState);
  }, []);

  const ask = async () => {
    setAsking(true);
    try {
      const next = await requestLiarsTorch();
      setState(next);
      onChange(next === "granted");
    } finally {
      setAsking(false);
    }
  };

  if (state === "unsupported") return null;

  return (
    <div className="border-t border-white/15 pt-5">
      <label className="flex min-h-11 items-center gap-3 font-mono text-xs text-white/60">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (!event.target.checked) {
              onChange(false);
              return;
            }
            if (state === "granted") onChange(true);
            else void ask();
          }}
          className="size-4 accent-[var(--things-amber)]"
        />
        flash the camera lamp when someone dies
      </label>
      <p
        className={`mt-1 font-mono text-xs ${
          state === "denied" ? "text-[var(--liars-dead)]" : "text-white/35"
        }`}
      >
        {asking ? "asking…" : liarsTorchAdvice(state ?? "prompt")}
      </p>
      {state === "denied" || state === "no-torch" ? (
        <button
          type="button"
          onClick={() => void ask()}
          className="mt-1 min-h-11 font-mono text-xs text-[var(--things-amber)]"
        >
          try again
        </button>
      ) : null}
    </div>
  );
}
