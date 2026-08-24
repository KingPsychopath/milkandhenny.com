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
import { GameSettingsTransfer } from "../shared/GameSettingsTransfer";
import { gameSettingsDocument } from "../shared/game-settings";
import { sameBrainBrowserKeys } from "./same-brain-keys";
import { createSameBrainRoomFn } from "./same-brain-room.functions";
import { sameBrainPlayerPath } from "./same-brain-invite";
import { SAME_BRAIN_PLAYER_LIMITS, SAME_BRAIN_ROUND_LIMITS } from "./same-brain-rules";
import { SAME_BRAIN_GAME_SETTINGS } from "./settings";
import { SoloSameBrain } from "./SoloSameBrain";
import type { SameBrainScoring } from "./types";
import { GamePoolDefaultLaunch } from "../pool/GamePoolDefaultLaunch";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "../pool/types";

/**
 * Any same brain game this device is still holding credentials for.
 *
 * Phones close tabs. People go to settings to change wifi and Safari reaps the page; somebody
 * follows a link and never finds their way back. Their seat is still in the room and their
 * credentials are still on the device, so the only thing missing was a door back in.
 */
function useLiveSameBrainSessions() {
  const [rooms, setRooms] = useState<string[]>([]);

  useEffect(() => {
    const prefix = gameNamespace("same-brain", 1);
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

/**
 * One page, two doors: open a room for a group of phones, or play the one-phone version where the
 * app only ever holds the question and the people in the room do the rest.
 *
 * House rules live behind "more" rather than on the surface. A group opening this wants one button;
 * the four settings underneath change how the game feels but nobody picks them the first time, and
 * they are remembered per device so the group that does care sets them once.
 */
export function SameBrainSetupApp({
  defaultPool,
}: {
  defaultPool?: GamePoolDefaultLaunchTarget | null;
}) {
  const navigate = useNavigate();
  // Remembered on this device, so a group's setup is one tap next time rather than five.
  const { preferences, set, replace } = useGamePreferences("same-brain", {
    rounds: SAME_BRAIN_GAME_SETTINGS.rounds,
    scoring: SAME_BRAIN_GAME_SETTINGS.scoring,
    sayItAloud: SAME_BRAIN_GAME_SETTINGS.sayItAloud,
    eliminateOddOne: SAME_BRAIN_GAME_SETTINGS.eliminateOddOne,
  });
  const scoring: SameBrainScoring = preferences.scoring === "exact" ? "exact" : "embedding";
  const rounds = Math.min(
    SAME_BRAIN_ROUND_LIMITS.max,
    Math.max(SAME_BRAIN_ROUND_LIMITS.min, preferences.rounds),
  );

  const [solo, setSolo] = useState(false);
  const [panel, setPanel] = useState<"join" | "more" | "solo" | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const liveRooms = useLiveSameBrainSessions();

  if (solo) return <SoloSameBrain onExit={() => setSolo(false)} />;

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await createSameBrainRoomFn({
        data: {
          rounds,
          scoring,
          toggles: {
            sayItAloud: preferences.sayItAloud,
            eliminateOddOne: preferences.eliminateOddOne,
          },
        },
      });
      // The host takes the first seat, so the person who opened the room is a player rather than a
      // spectator with a control panel.
      writeExpiringLocalValue(
        sameBrainBrowserKeys.invite(created.roomId),
        created.joinToken,
        created.expiresAt,
      );
      writeExpiringLocalValue(
        sameBrainBrowserKeys.hostSession(created.roomId),
        { hostToken: created.hostToken },
        created.expiresAt,
      );
      await navigate({ to: sameBrainPlayerPath(created.roomId) });
    } catch {
      setMessage("Could not open a room. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <GameShell tone="night">
      <div className="flex min-h-svh flex-col text-white">
        <header className="mx-auto w-full max-w-lg px-5 pt-4 font-mono text-xs text-white/45">
          <Link to="/things" className="inline-flex min-h-11 items-center">
            ← things
          </Link>
        </header>
        <main id="main" className="flex-1 px-5 pb-20">
          <GameLaunch
            tone="night"
            eyebrow={`party game · ${SAME_BRAIN_PLAYER_LIMITS.min}–${SAME_BRAIN_PLAYER_LIMITS.max} people`}
            title="same brain"
            description="Everyone answers the same question. Answer like everyone else and score together — try not to be the odd one out."
          >
            {defaultPool ? (
              <GamePoolDefaultLaunch pool={defaultPool}>find a room</GamePoolDefaultLaunch>
            ) : (
              <GameLaunchButton accent="amber" onClick={() => void open()} disabled={busy}>
                {busy ? "opening…" : "open a room"}
              </GameLaunchButton>
            )}
            <GameLaunchMeta tone="dark">
              {defaultPool
                ? `${defaultPool.label} · settings ready · everyone plays on their own phone`
                : `${rounds} rounds · everyone plays on their own phone`}
            </GameLaunchMeta>

            {liveRooms.length > 0 ? (
              <p className="mt-5 text-center font-mono text-xs text-white/45">
                still in{" "}
                {liveRooms.map((roomId, index) => (
                  <span key={roomId}>
                    {index > 0 ? ", " : ""}
                    <Link
                      to={sameBrainPlayerPath(roomId)}
                      className="text-[var(--things-amber)] underline underline-offset-4"
                    >
                      {roomId}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}

            <GameLaunchChoices tone="dark">
              {defaultPool ? (
                <button
                  type="button"
                  onClick={() => void open()}
                  disabled={busy}
                  className="min-h-11 disabled:opacity-40"
                >
                  {busy ? "opening…" : "private room"}
                </button>
              ) : null}
              <button
                type="button"
                aria-pressed={panel === "join"}
                onClick={() => setPanel(panel === "join" ? null : "join")}
                className="min-h-11"
              >
                join by code
              </button>
              <button
                type="button"
                aria-pressed={panel === "solo"}
                onClick={() => setPanel(panel === "solo" ? null : "solo")}
                className="min-h-11"
              >
                one phone
              </button>
              <button
                type="button"
                aria-pressed={panel === "more"}
                onClick={() => setPanel(panel === "more" ? null : "more")}
                className="min-h-11"
              >
                house rules
              </button>
            </GameLaunchChoices>

            {panel === "join" ? (
              <div className="mt-6 border-t border-white/15 pt-5">
                <RoomJoinControl
                  value={roomCode}
                  gamePath="/things/same-brain"
                  tone="dark"
                  message={message}
                  onValueChange={setRoomCode}
                  onJoin={(code) => void navigate({ to: sameBrainPlayerPath(code) })}
                />
              </div>
            ) : null}

            {panel === "more" ? (
              <div className="mt-3">
                <label className="flex min-h-11 items-center gap-3 font-mono text-xs text-white/60">
                  rounds
                  <input
                    type="number"
                    min={SAME_BRAIN_ROUND_LIMITS.min}
                    max={SAME_BRAIN_ROUND_LIMITS.max}
                    value={rounds}
                    onChange={(event) => set("rounds", Number(event.target.value))}
                    className="w-16 border border-white/20 bg-transparent px-2 py-1 text-white"
                  />
                </label>

                <SetupToggle
                  label="say the answers out loud"
                  hint="counts everyone down, then shows you your own word — for a room, not a call"
                  checked={preferences.sayItAloud}
                  onChange={(next) => set("sayItAloud", next)}
                />
                <SetupToggle
                  label="count near-misses as the same answer"
                  hint="sea and ocean score together; off, only identical answers do"
                  checked={scoring === "embedding"}
                  onChange={(next) => set("scoring", next ? "embedding" : "exact")}
                />
                <SetupToggle
                  label="the odd one out is eliminated"
                  hint="off, the loner just misses out; on, they leave the game"
                  checked={preferences.eliminateOddOne}
                  onChange={(next) => set("eliminateOddOne", next)}
                />
                <p className="mt-4 font-mono text-xs text-white/30">
                  All of these can still be changed in the lobby before anybody answers.
                </p>
                <GameSettingsTransfer
                  document={gameSettingsDocument("same-brain", {
                    game: "same-brain",
                    rounds,
                    scoring,
                    sayItAloud: preferences.sayItAloud,
                    eliminateOddOne: preferences.eliminateOddOne,
                  })}
                  onApply={replace}
                />
              </div>
            ) : null}

            {panel === "solo" ? (
              <div className="mt-6 border-t border-white/15 pt-6">
                <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
                  one phone
                </p>
                <p className="mt-2 font-serif text-lg leading-relaxed text-white/70">
                  Reads the question out and gets out of the way. You argue about who agreed and
                  keep score yourselves.
                </p>
                <button
                  type="button"
                  onClick={() => setSolo(true)}
                  className="mt-4 min-h-12 rounded-full border border-white/25 px-6 font-mono text-xs text-white/80 hover:border-[var(--things-amber)] hover:text-[var(--things-amber)]"
                >
                  just the questions
                </button>
              </div>
            ) : null}
          </GameLaunch>
        </main>
      </div>
    </GameShell>
  );
}

function SetupToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="mt-4 flex min-h-11 items-start gap-3 font-mono text-xs text-white/70">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        {label}
        <span className="block text-white/35">{hint}</span>
      </span>
    </label>
  );
}
