import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useGamePreferences } from "../shared/useGamePreferences";
import { centreBrowserKeys } from "./centre-keys";
import { recentSoloCentreReplays, type SoloCentreReplay } from "./centre-replays.client";
import { createCentreRoomFn } from "./centre-room.functions";
import { primeCentreAudio } from "./centre-sound.client";
import { SoloCentreGame } from "./SoloCentreGame";
import type { CentreDifficulty, CentrePlayerCredentials } from "./types";

const DIFFICULTY_LABELS = ["calm", "easy", "medium", "hard", "brutal"] as const;

function freshSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function dailySeed() {
  const day = new Date().toISOString().slice(0, 10);
  let hash = 0x811c9dc5;
  for (const character of `centre:${day}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

type SoloChoice = { seed: number; difficulty: CentreDifficulty; ghost?: SoloCentreReplay | null };

export function CentreApp() {
  const navigate = useNavigate();
  const haptics = useWebHaptics();
  const { preferences, set } = useGamePreferences("centre", {
    difficulty: 3,
    delayedRivals: false,
  });
  const difficulty = preferences.difficulty as CentreDifficulty;
  const [solo, setSolo] = useState<SoloChoice | null>(null);
  const [recent, setRecent] = useState<SoloCentreReplay[]>([]);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [panel, setPanel] = useState<"friends" | "join" | "options" | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void recentSoloCentreReplays()
      .then(setRecent)
      .catch(() => undefined);
  }, []);

  if (solo)
    return (
      <SoloCentreGame
        {...solo}
        onExit={() => setSolo(null)}
        onNewMaze={() => setSolo({ seed: freshSeed(), difficulty })}
      />
    );

  const createRoom = async () => {
    if (!name.trim() || creating) {
      setMessage("Add your name to make a room.");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const room = await createCentreRoomFn({
        data: {
          hostName: name.trim(),
          difficulty,
          delayedRivals: preferences.delayedRivals,
        },
      });
      sessionStorage.setItem(centreBrowserKeys.invite(room.roomId), room.joinToken);
      const credentials: CentrePlayerCredentials = {
        roomId: room.roomId,
        expiresAt: room.expiresAt,
        playerId: room.playerId,
        playerToken: room.playerToken,
        snapshot: room.snapshot,
      };
      writeExpiringLocalValue(
        centreBrowserKeys.playerSession(room.roomId),
        credentials,
        room.expiresAt,
      );
      void haptics.trigger("success");
      await navigate({ to: "/things/centre/$roomId", params: { roomId: room.roomId } });
    } catch {
      setCreating(false);
      setMessage("Could not make the room. Check your connection and try again.");
    }
  };

  const join = async (code = joinCode) => {
    const roomId = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/centre/$roomId", params: { roomId } });
  };

  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <Link to="/things">← things</Link>
        <span>centre</span>
      </header>
      <main id="main" className="centre-launch">
        <GameLaunch
          tone="theme"
          eyebrow="trace race · 1–8 people"
          title="First to the middle wins."
          description="Ready at the start. The maze appears at GO. Find the route before everyone else."
        >
          <GameLaunchButton
            accent="amber"
            onClick={() => {
              primeCentreAudio();
              setSolo({ seed: freshSeed(), difficulty });
              void haptics.trigger("selection");
            }}
          >
            new solo maze
          </GameLaunchButton>
          <GameLaunchMeta tone="theme">ready · 3 · 2 · 1 · trace to the centre</GameLaunchMeta>
          <GameLaunchChoices tone="theme">
            <button
              type="button"
              onClick={() => setSolo({ seed: dailySeed(), difficulty })}
              className="min-h-11"
            >
              play today’s maze
            </button>
            {recent[0] ? (
              <button
                type="button"
                onClick={() =>
                  setSolo({
                    seed: recent[0].seed,
                    difficulty: recent[0].difficulty,
                    ghost: recent[0],
                  })
                }
                className="min-h-11"
              >
                race my ghost
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPanel(panel === "friends" ? null : "friends")}
              aria-pressed={panel === "friends"}
              className="min-h-11"
            >
              race friends
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "options" ? null : "options")}
              aria-pressed={panel === "options"}
              className="min-h-11"
            >
              change difficulty
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "join" ? null : "join")}
              aria-pressed={panel === "join"}
              className="min-h-11"
            >
              join a room
            </button>
          </GameLaunchChoices>
        </GameLaunch>
        {panel === "friends" ? (
          <section className="centre-panel" aria-labelledby="centre-friends-title">
            <h2 id="centre-friends-title">Everyone on their own screen</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createRoom();
              }}
            >
              <label className="centre-field">
                <span>your name</span>
                <input
                  value={name}
                  maxLength={32}
                  required
                  autoComplete="name"
                  onChange={(event) => {
                    setName(event.target.value);
                    setMessage(null);
                  }}
                />
              </label>
              <label className="centre-check">
                <input
                  type="checkbox"
                  checked={preferences.delayedRivals}
                  onChange={(event) => set("delayedRivals", event.target.checked)}
                />
                <span>show delayed rival dots</span>
              </label>
              <button type="submit" disabled={creating} className="centre-button centre-button--go">
                {creating ? "making room…" : "create room"}
              </button>
            </form>
          </section>
        ) : null}
        {panel === "join" ? (
          <section className="centre-panel" aria-label="Join a room">
            <RoomJoinControl
              value={joinCode}
              gamePath="/things/centre"
              tone="dark"
              message={message}
              onValueChange={(value) => {
                setJoinCode(value);
                setMessage(null);
              }}
              onJoin={join}
            />
          </section>
        ) : null}
        {panel === "options" ? (
          <section className="centre-panel" aria-labelledby="centre-options-title">
            <h2 id="centre-options-title">Options</h2>
            <label className="centre-difficulty">
              <span>difficulty</span>
              <strong>{DIFFICULTY_LABELS[difficulty - 1]}</strong>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={difficulty}
                onChange={(event) => set("difficulty", Number(event.target.value))}
              />
            </label>
          </section>
        ) : null}
        {message && panel !== "join" ? (
          <p role="status" className="centre-message">
            {message}
          </p>
        ) : null}
      </main>
    </div>
  );
}
