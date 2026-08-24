import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppSelect } from "@/components/AppSelect";
import { GamePoolDefaultLaunch } from "../pool/GamePoolDefaultLaunch";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "../pool/types";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { GameShell } from "../shared/GameShell";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { useGamePreferences } from "../shared/useGamePreferences";
import { useGameScreenHistory } from "../shared/useGameScreenHistory";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { createHotAndColdRoomFn } from "./hot-and-cold.functions";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { hotAndColdRoomPath } from "./hot-and-cold-invite";
import { HOT_AND_COLD_GAME_SETTINGS } from "./settings";
import { SoloHotAndCold } from "./SoloHotAndCold";

export function HotAndColdApp({
  puzzle,
  defaultPool,
}: {
  puzzle: number;
  defaultPool?: GamePoolDefaultLaunchTarget | null;
}) {
  const navigate = useNavigate();
  const { name, setName, remember } = useRememberedPlayerName(24);
  const [solo, setSolo] = useState(false);
  const [panel, setPanel] = useState<"room" | "join" | "settings" | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { preferences, set } = useGamePreferences("hot-and-cold", {
    rounds: HOT_AND_COLD_GAME_SETTINGS.rounds,
    guessesPerPlayer: HOT_AND_COLD_GAME_SETTINGS.guessesPerPlayer,
    turnSeconds: HOT_AND_COLD_GAME_SETTINGS.turnSeconds,
  });
  useGameScreenHistory({ active: solo, screen: "daily", onBack: () => setSolo(false) });
  if (solo) return <SoloHotAndCold puzzle={puzzle} onExit={() => setSolo(false)} />;
  const openRoom = async () => {
    if (!name.trim() || busy) {
      setPanel("room");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const room = await createHotAndColdRoomFn({
        data: {
          hostName: name.trim(),
          rounds: preferences.rounds,
          guessesPerPlayer: preferences.guessesPerPlayer,
          turnSeconds: preferences.turnSeconds,
        },
      });
      remember(name);
      writeExpiringLocalValue(
        hotAndColdBrowserKeys.invite(room.roomId),
        room.joinToken,
        room.expiresAt,
      );
      writeExpiringLocalValue(
        hotAndColdBrowserKeys.playerSession(room.roomId),
        room,
        room.expiresAt,
      );
      await navigate({ to: hotAndColdRoomPath(room.roomId) });
    } catch {
      setMessage("Could not open a room");
      setBusy(false);
    }
  };
  return (
    <GameShell tone="stone">
      <div className="hot-and-cold min-h-svh">
        <header className="mx-auto max-w-lg px-5 pt-3">
          <Link
            to="/things"
            className="inline-flex min-h-11 items-center font-mono text-xs theme-muted"
          >
            ← things
          </Link>
        </header>
        <main id="main" className="mx-auto max-w-lg px-5 pb-20">
          <GameLaunch
            tone="theme"
            eyebrow="word game · 1–8 people"
            title="hot and cold"
            description="Guess the hidden word. Lower numbers take you closer to the heat. Zero finds it."
          >
            <GameLaunchButton accent="amber" onClick={() => setSolo(true)}>
              play today’s word
            </GameLaunchButton>
            <GameLaunchMeta tone="theme">daily #{puzzle} · unlimited guesses</GameLaunchMeta>
            {defaultPool ? (
              <GamePoolDefaultLaunch pool={defaultPool} tone="theme" emphasis="secondary">
                find a public room
              </GamePoolDefaultLaunch>
            ) : null}
            <GameLaunchChoices tone="theme">
              <button
                type="button"
                className="min-h-11"
                onClick={() => setPanel(panel === "room" ? null : "room")}
              >
                {defaultPool ? "private room" : "open a room"}
              </button>
              <button
                type="button"
                className="min-h-11"
                onClick={() => setPanel(panel === "join" ? null : "join")}
              >
                join by code
              </button>
              <button
                type="button"
                className="min-h-11"
                onClick={() => setPanel(panel === "settings" ? null : "settings")}
              >
                room rules
              </button>
            </GameLaunchChoices>
            {panel === "room" ? (
              <div className="mt-6 border-t theme-border pt-5">
                <label className="font-mono text-xs theme-muted">
                  <span className="block pb-2">your name</span>
                  <input
                    value={name}
                    autoComplete="name"
                    maxLength={24}
                    onChange={(event) => setName(event.target.value)}
                    className="min-h-12 w-full rounded-full border theme-border bg-transparent px-5 text-base"
                  />
                </label>
                <button
                  type="button"
                  disabled={!name.trim() || busy}
                  onClick={() => void openRoom()}
                  className="mt-4 min-h-14 w-full rounded-full bg-[var(--foreground)] font-mono text-xs font-bold text-[var(--background)] disabled:opacity-40"
                >
                  {busy ? "opening…" : "open room"}
                </button>
              </div>
            ) : null}
            {panel === "join" ? (
              <div className="mt-6 border-t theme-border pt-5">
                <RoomJoinControl
                  value={roomCode}
                  gamePath="/things/hot-and-cold"
                  tone="theme"
                  message={message}
                  onValueChange={setRoomCode}
                  onJoin={(code) => void navigate({ to: hotAndColdRoomPath(code) })}
                />
              </div>
            ) : null}
            {panel === "settings" ? (
              <div className="mt-6 grid grid-cols-3 gap-3 border-t theme-border pt-5 font-mono text-xs theme-muted">
                <label>
                  rounds
                  <AppSelect
                    value={preferences.rounds}
                    onValueChange={(value) => set("rounds", Number(value))}
                    ariaLabel="Rounds"
                    tone="theme"
                    className="mt-2 min-h-11 w-full"
                    options={[1, 3, 5, 7].map((value) => ({ value, label: String(value) }))}
                  />
                </label>
                <label>
                  guesses
                  <AppSelect
                    value={preferences.guessesPerPlayer}
                    onValueChange={(value) => set("guessesPerPlayer", Number(value))}
                    ariaLabel="Guesses per player"
                    tone="theme"
                    className="mt-2 min-h-11 w-full"
                    options={[2, 4, 6, 8].map((value) => ({ value, label: String(value) }))}
                  />
                </label>
                <label>
                  turn
                  <AppSelect
                    value={preferences.turnSeconds}
                    onValueChange={(value) => set("turnSeconds", Number(value))}
                    ariaLabel="Turn time"
                    tone="theme"
                    className="mt-2 min-h-11 w-full"
                    options={[10, 15, 20, 30, 0].map((value) => ({
                      value,
                      label: value ? `${value}s` : "none",
                    }))}
                  />
                </label>
                <p className="col-span-3 mt-2 font-serif text-sm leading-relaxed">
                  Each round has a different word. The starter rotates and gets one free opening
                  guess.
                </p>
              </div>
            ) : null}
            {message ? (
              <p role="status" className="mt-4 font-mono text-xs text-[var(--things-amber)]">
                {message}
              </p>
            ) : null}
          </GameLaunch>
        </main>
      </div>
    </GameShell>
  );
}
