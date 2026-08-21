import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { GameShell } from "../shared/GameShell";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { gameNamespace } from "../shared/multiplayer-keys";
import { useGamePreferences } from "../shared/useGamePreferences";
import { liarsBrowserKeys } from "./liars-keys";
import {
  LIARS_MODE_COPY,
  LIARS_PLAYER_LIMITS,
  liarsDefaultLineup,
  liarsImposterBlurb,
  liarsImposterRange,
} from "./liars-rules";
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

const MAFIA_BLURB =
  "Someone here is killing people at night. Find them before they run out of people.";

/**
 * One decision on the surface — which game — and everything else folded away behind it.
 *
 * The two modes want different explanations, different player counts and different roles, so the
 * toggle is not a setting among settings: it is the thing the page is about, and choosing it
 * reflows what is underneath. Everything a group will never touch lives under "more".
 */
/**
 * Any liars game this device is still holding credentials for.
 *
 * Phones close tabs. People go to settings to change wifi and Safari reaps the page; somebody
 * follows a link and never finds their way back. Their seat is still in the room and their
 * credentials are still on the device, so the only thing missing was a door back in.
 */
function useLiveLiarsSessions() {
  const [rooms, setRooms] = useState<string[]>([]);

  useEffect(() => {
    const prefix = gameNamespace("liars", 1);
    const found: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix) || !key.endsWith(":player-session")) continue;
        const roomId = key.split(":room:")[1]?.split(":")[0];
        if (!roomId) continue;
        // Reading it also prunes it: an expired session removes its own key.
        if (readExpiringLocalValue(key)) found.push(roomId);
      }
    } catch {
      // Storage unavailable; there is simply nothing to resume.
    }
    setRooms([...new Set(found)]);
  }, []);

  return rooms;
}

export function LiarsSetupApp() {
  const navigate = useNavigate();
  // Remembered on this device, so a group's setup is one tap next time rather than eight.
  const { preferences, set } = useGamePreferences("liars", {
    mode: "mafia",
    roomMode: "same-room",
    players: 9,
    imposters: 1,
    wordBoard: true,
    firstGame: false,
    blindImposters: false,
  });
  const mode = preferences.mode === "imposter" ? "imposter" : ("mafia" as LiarsMode);
  const roomMode = preferences.roomMode === "remote" ? "remote" : ("same-room" as LiarsRoomMode);
  const firstGame = preferences.firstGame;
  const blindImposters = preferences.blindImposters;
  const expected = preferences.players;
  const [torch, setTorch] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [panel, setPanel] = useState<"roles" | "more" | "join" | null>(null);
  const imposters = preferences.imposters;
  const wordBoard = preferences.wordBoard;
  const liveRooms = useLiveLiarsSessions();

  const limits = LIARS_PLAYER_LIMITS[mode];
  const players = Math.min(limits.max, Math.max(limits.min, expected));
  const imposterRange = liarsImposterRange(players);
  const imposterCount = Math.min(imposterRange.max, Math.max(imposterRange.min, imposters));
  const blurb = mode === "mafia" ? MAFIA_BLURB : liarsImposterBlurb(imposterCount);
  const lineup = liarsDefaultLineup(mode, players, imposterCount);

  const chooseMode = (next: LiarsMode) => {
    set("mode", next);
    set(
      "players",
      Math.min(LIARS_PLAYER_LIMITS[next].max, Math.max(LIARS_PLAYER_LIMITS[next].min, expected)),
    );
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const toggles: Partial<LiarsToggles> = {
        firstGame,
        cameraTorch: torch,
        blindImposters,
        wordBoard,
      };
      const room = await createLiarsRoomFn({
        data: { mode, roomMode, toggles, ...(mode === "imposter" ? { lineup } : {}) },
      });
      writeExpiringLocalValue(
        liarsBrowserKeys.hostSession(room.roomId),
        { hostToken: room.hostToken, joinToken: room.joinToken },
        room.expiresAt,
      );
      writeExpiringLocalValue(liarsBrowserKeys.invite(room.roomId), room.joinToken, room.expiresAt);
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
          description="Two games, one room. Everyone has something to do every round, and the phone keeps track of all of it so you can argue."
        >
          <div>
            {liveRooms.length > 0 ? (
              <div className="mb-6 border-y border-[var(--things-amber)]/30 py-4">
                <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                  you are still in a game
                </p>
                <ul className="mt-2 space-y-2">
                  {liveRooms.map((roomId) => (
                    <li key={roomId}>
                      <button
                        type="button"
                        onClick={() => void navigate({ to: liarsPlayerPath(roomId) })}
                        className="min-h-11 font-mono text-sm text-[var(--things-amber)] hover:underline"
                      >
                        rejoin {roomId} →
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <GameLaunchButton
              accent="amber"
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              {creating
                ? "opening…"
                : `open ${LIARS_MODE_COPY[mode].article} ${LIARS_MODE_COPY[mode].name} room`}
            </GameLaunchButton>
            <GameLaunchMeta tone="dark">
              you play too · everyone joins with the room code
            </GameLaunchMeta>

            {mode === "imposter" ? (
              <p className="mt-4 font-mono text-xs text-white/40">
                only got one phone?{" "}
                <Link
                  to="/things/liars/phone"
                  className="underline underline-offset-4 hover:text-white/80"
                >
                  pass it round instead
                </Link>
              </p>
            ) : null}

            <GameLaunchChoices tone="dark">
              <button
                type="button"
                aria-pressed={panel === "roles"}
                onClick={() => setPanel(panel === "roles" ? null : "roles")}
                className="min-h-11"
              >
                choose the game
              </button>
              <button
                type="button"
                aria-pressed={panel === "more"}
                onClick={() => setPanel(panel === "more" ? null : "more")}
                className="min-h-11"
              >
                advanced settings
              </button>
              <button
                type="button"
                aria-pressed={panel === "join"}
                onClick={() => setPanel(panel === "join" ? null : "join")}
                className="min-h-11"
              >
                join a room
              </button>
            </GameLaunchChoices>

            {panel === "roles" ? (
              <div className="mt-3">
                <div
                  role="radiogroup"
                  aria-label="which game"
                  className="flex rounded-full border border-white/20 p-1"
                >
                  {(["mafia", "imposter"] as const).map((id) => {
                    const active = mode === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => chooseMode(id)}
                        className={`min-h-12 flex-1 rounded-full px-4 font-mono text-sm font-bold transition-colors ${
                          active
                            ? "bg-[var(--things-amber)] text-black"
                            : "text-white/55 hover:text-white/85"
                        }`}
                      >
                        {id}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-5 font-serif text-lg leading-relaxed text-white/70">{blurb}</p>
                <div className="mt-6">
                  <label className="font-mono text-xs text-white/55">
                    <span className="block pb-2">how many of you · {players}</span>
                    <input
                      type="range"
                      min={limits.min}
                      max={limits.max}
                      value={players}
                      onChange={(event) => set("players", Number(event.target.value))}
                      className="w-full accent-[var(--things-amber)]"
                    />
                  </label>
                  <p className="mt-1 font-mono text-micro text-white/30">
                    {limits.min}–{limits.max} for {mode}
                  </p>
                </div>
                {mode === "imposter" ? (
                  <div className="mb-5">
                    <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                      how hard for the imposter
                    </p>
                    <div className="mt-2 flex gap-2">
                      {(
                        [
                          [true, "a shortlist"],
                          [false, "nothing"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={wordBoard === value}
                          onClick={() => set("wordBoard", value)}
                          className={`min-h-11 flex-1 rounded-full border px-4 font-mono text-xs ${
                            wordBoard === value
                              ? "border-[var(--things-amber)] text-[var(--things-amber)]"
                              : "border-white/20 text-white/55"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 font-mono text-xs text-white/35">
                      {wordBoard
                        ? "everyone sees twelve words from the category, one of them the real one — the imposter has something to work from, and you have to prove you know the word without giving it away"
                        : "the imposter gets the category and nothing else — faster, crueller, and much harder for them"}
                    </p>
                  </div>
                ) : null}
                {mode === "imposter" && imposterRange.max > 1 ? (
                  <div className="mb-4">
                    <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                      how many imposters
                    </p>
                    <div className="mt-2 flex gap-2">
                      {Array.from({ length: imposterRange.max }, (_, index) => index + 1).map(
                        (count) => (
                          <button
                            key={count}
                            type="button"
                            aria-pressed={imposterCount === count}
                            onClick={() => set("imposters", count)}
                            className={`min-h-11 flex-1 rounded-full border px-4 font-mono text-xs ${
                              imposterCount === count
                                ? "border-[var(--things-amber)] text-[var(--things-amber)]"
                                : "border-white/20 text-white/55"
                            }`}
                          >
                            {count}
                          </button>
                        ),
                      )}
                    </div>
                    <p className="mt-2 font-mono text-xs text-white/35">
                      {imposterCount > 1
                        ? "they know each other, unless you turn that off under advanced settings"
                        : "one liar, and nowhere to hide"}
                    </p>
                  </div>
                ) : null}
                <LineupBoard mode={mode} lineup={lineup} playerCount={players} />
                <p className="mt-3 font-mono text-xs text-white/35">
                  follows the room as people join · the host can change it before the deal
                </p>
              </div>
            ) : null}

            {panel === "more" ? (
              <div className="mt-3 space-y-5">
                <div>
                  <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                    where is everyone
                  </p>
                  <div className="mt-2 flex gap-2">
                    {(["same-room", "remote"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={roomMode === option}
                        onClick={() => set("roomMode", option)}
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

                <div className="border-t border-white/15 pt-4">
                  <label className="flex min-h-11 items-center gap-3 font-mono text-xs text-white/60">
                    <input
                      type="checkbox"
                      checked={firstGame}
                      onChange={(event) => set("firstGame", event.target.checked)}
                      className="size-4 accent-[var(--things-amber)]"
                    />
                    nobody here has played before
                  </label>
                  <p className="mt-1 font-mono text-xs text-white/35">
                    {mode === "mafia"
                      ? "doctor, detective and villagers only, and a longer look at your role"
                      : "one imposter, no understudy, and a longer look at your word"}
                  </p>
                </div>

                {mode === "imposter" && imposterCount > 1 ? (
                  <div className="border-t border-white/15 pt-4">
                    <label className="flex min-h-11 items-center gap-3 font-mono text-xs text-white/60">
                      <input
                        type="checkbox"
                        checked={blindImposters}
                        onChange={(event) => set("blindImposters", event.target.checked)}
                        className="size-4 accent-[var(--things-amber)]"
                      />
                      the imposters don't know each other
                    </label>
                    <p className="mt-1 font-mono text-xs text-white/35">
                      brutal, and very funny — each of them assumes the other is crew
                    </p>
                  </div>
                ) : null}

                <TorchToggle enabled={torch} onChange={setTorch} />
              </div>
            ) : null}

            {panel === "join" ? (
              <div className="mt-8 border-t border-white/15 pt-5">
                <RoomJoinControl
                  value={joinCode}
                  gamePath="things/liars"
                  tone="dark"
                  message={message}
                  onValueChange={setJoinCode}
                  onJoin={(code) => navigate({ to: liarsPlayerPath(code) })}
                />
              </div>
            ) : null}
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
    <div className="border-t border-white/15 pt-4">
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
