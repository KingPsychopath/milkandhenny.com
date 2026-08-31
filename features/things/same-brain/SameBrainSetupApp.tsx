import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { sameBrainBrowserKeys } from "./same-brain-keys";
import { createSameBrainRoomFn } from "./same-brain-room.functions";
import { sameBrainPlayerPath } from "./same-brain-invite";
import { SAME_BRAIN_PLAYER_LIMITS, SAME_BRAIN_ROUND_LIMITS } from "./same-brain-rules";
import { SAME_BRAIN_GAME_SETTINGS } from "./settings";
import { SoloSameBrain } from "./SoloSameBrain";
import { GamePoolDefaultLaunch } from "../pool/GamePoolDefaultLaunch";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "../pool/types";
import { useSafeGameNavigation } from "../shared/useSafeGameNavigation";

/**
 * One page, two doors: open a room for a group of phones, or play the one-phone version where the
 * app only ever holds the question and the people in the room do the rest.
 *
 * Settings live behind one secondary action. A group opening this wants one clear door; the options
 * underneath change the feel of the game and are remembered on this device.
 */
export function SameBrainSetupApp({
  defaultPool,
  initialSolo = false,
}: {
  defaultPool?: GamePoolDefaultLaunchTarget | null;
  initialSolo?: boolean;
}) {
  const navigate = useNavigate();
  // Remembered on this device, so a group's setup is one tap next time rather than five.
  const { preferences, set, replace } = useGamePreferences("same-brain", {
    rounds: SAME_BRAIN_GAME_SETTINGS.rounds,
    sayItAloud: SAME_BRAIN_GAME_SETTINGS.sayItAloud,
    eliminateOddOne: SAME_BRAIN_GAME_SETTINGS.eliminateOddOne,
    revealAuthors: SAME_BRAIN_GAME_SETTINGS.revealAuthors,
  });
  const rounds = Math.min(
    SAME_BRAIN_ROUND_LIMITS.max,
    Math.max(SAME_BRAIN_ROUND_LIMITS.min, preferences.rounds),
  );

  const [panel, setPanel] = useState<"join" | "more" | "solo" | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useSafeGameNavigation(!initialSolo);

  if (initialSolo)
    return (
      <SoloSameBrain onExit={() => void navigate({ to: "/things/same-brain", replace: true })} />
    );

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await createSameBrainRoomFn({
        data: {
          rounds,
          toggles: {
            sayItAloud: preferences.sayItAloud,
            eliminateOddOne: preferences.eliminateOddOne,
            revealAuthors: preferences.revealAuthors,
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
              <GamePoolDefaultLaunch pool={defaultPool}>play together</GamePoolDefaultLaunch>
            ) : (
              <GameLaunchButton accent="amber" onClick={() => void open()} disabled={busy}>
                {busy ? "opening…" : "play together"}
              </GameLaunchButton>
            )}
            <GameLaunchMeta tone="dark">
              {defaultPool
                ? `${defaultPool.label} · settings ready · everyone plays on their own phone`
                : `${rounds} rounds · everyone plays on their own phone`}
            </GameLaunchMeta>

            <GameLaunchChoices tone="dark">
              {!defaultPool ? (
                <button
                  type="button"
                  aria-pressed={panel === "join"}
                  onClick={() => setPanel(panel === "join" ? null : "join")}
                  className="min-h-11"
                >
                  enter a room code
                </button>
              ) : null}
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
                settings
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
                  hint="everyone sees their own answer, then says it together"
                  checked={preferences.sayItAloud}
                  onChange={(next) => set("sayItAloud", next)}
                />
                <SetupToggle
                  label="show who wrote each answer"
                  hint="names appear beside answers on the reveal"
                  checked={preferences.revealAuthors}
                  onChange={(next) => set("revealAuthors", next)}
                />
                <SetupToggle
                  label="the odd one out is eliminated"
                  hint="off, the loner just misses out; on, they leave the game"
                  checked={preferences.eliminateOddOne}
                  onChange={(next) => set("eliminateOddOne", next)}
                />
                <p className="mt-4 font-mono text-xs text-white/30">
                  The host can change these in the lobby before the game starts.
                </p>
                <GameSettingsTransfer
                  document={gameSettingsDocument("same-brain", {
                    game: "same-brain",
                    rounds,
                    sayItAloud: preferences.sayItAloud,
                    eliminateOddOne: preferences.eliminateOddOne,
                    revealAuthors: preferences.revealAuthors,
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
                  onClick={() => void navigate({ to: "/things/same-brain/solo" })}
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
