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
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useGamePreferences } from "../shared/useGamePreferences";
import { GameSettingsTransfer } from "../shared/GameSettingsTransfer";
import { gameSettingsDocument } from "../shared/game-settings";
import { liarsBrowserKeys } from "./liars-keys";
import {
  LIARS_PLAYER_LIMITS,
  LIARS_MODE_COPY,
  liarsDefaultLineup,
  liarsImposterBlurb,
  liarsImposterRange,
} from "./liars-rules";
import { createLiarsRoomFn } from "./liars-room.functions";
import { LIARS_GAME_SETTINGS } from "./settings";
import { liarsPlayerPath } from "./liars-invite";
import { LineupBoard } from "./LiarsViews";
import {
  liarsTorchAdvice,
  liarsTorchState,
  requestLiarsTorch,
  type LiarsTorchState,
} from "./torch.client";
import type { LiarsMode, LiarsRoomMode, LiarsToggles } from "./types";

/**
 * Mafia and Imposter are separate catalogue journeys, but deliberately share this setup and room
 * engine. The route fixes the mode so a remembered preference or imported settings file can never
 * turn the game somebody selected into the other one.
 */
export function LiarsSetupApp({ mode }: { mode: LiarsMode }) {
  const navigate = useNavigate();
  // Remembered on this device, so a group's setup is one tap next time rather than eight.
  const { preferences, set, replace } = useGamePreferences("liars", {
    mode: LIARS_GAME_SETTINGS.mode,
    roomMode: LIARS_GAME_SETTINGS.roomMode,
    players: 9,
    imposters: 1,
    wordBoard: LIARS_GAME_SETTINGS.wordBoard,
    firstGame: LIARS_GAME_SETTINGS.firstGame,
    blindImposters: LIARS_GAME_SETTINGS.blindImposters,
  });
  const roomMode = preferences.roomMode === "remote" ? "remote" : ("same-room" as LiarsRoomMode);
  const firstGame = preferences.firstGame;
  const blindImposters = preferences.blindImposters;
  const expected = preferences.players;
  const [torch, setTorch] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [panel, setPanel] = useState<"game" | "more" | "join" | null>(null);
  const imposters = preferences.imposters;
  const wordBoard = preferences.wordBoard;

  const limits = LIARS_PLAYER_LIMITS[mode];
  const players = Math.min(limits.max, Math.max(limits.min, expected));
  const imposterRange = liarsImposterRange(players);
  const imposterCount = Math.min(imposterRange.max, Math.max(imposterRange.min, imposters));
  const blurb =
    mode === "mafia" ? LIARS_MODE_COPY.mafia.tagline : liarsImposterBlurb(imposterCount);
  const lineup = liarsDefaultLineup(mode, players, imposterCount);

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
        { hostToken: room.hostToken, joinToken: room.joinToken, mode },
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
          eyebrow={`social deduction · ${limits.min}–${limits.max} people`}
          title={LIARS_MODE_COPY[mode].name}
          description={blurb}
        >
          <div>
            <GameLaunchButton
              accent="amber"
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              {creating ? "opening…" : "play together"}
            </GameLaunchButton>
            <GameLaunchMeta tone="dark">
              you play too · everyone joins with the room code
            </GameLaunchMeta>
            {message ? (
              <p className="mt-3 font-mono text-xs text-[var(--things-amber)]" role="status">
                {message}
              </p>
            ) : null}

            {mode === "imposter" ? (
              <p className="mt-4 font-mono text-xs text-white/40">
                only got one phone?{" "}
                <Link
                  to="/things/imposter/phone"
                  className="underline underline-offset-4 hover:text-white/80"
                >
                  pass it round instead
                </Link>
              </p>
            ) : null}

            <GameLaunchChoices tone="dark">
              <button
                type="button"
                aria-pressed={panel === "game"}
                onClick={() => setPanel(panel === "game" ? null : "game")}
                className="min-h-11"
              >
                game settings
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
                enter a room code
              </button>
            </GameLaunchChoices>

            {panel === "game" ? (
              <div className="mt-3">
                <div>
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
                <GameSettingsTransfer
                  document={gameSettingsDocument("liars", {
                    game: "liars",
                    mode,
                    roomMode,
                    firstGame,
                    blindImposters,
                    wordBoard,
                  })}
                  onApply={(settings) => replace({ ...settings, mode })}
                />
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
