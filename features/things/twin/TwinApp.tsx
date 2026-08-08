import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { AppSelect } from "@/components/AppSelect";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useGamePreferences } from "../shared/useGamePreferences";
import { TWIN_MAX_HAND, TWIN_MIN_HAND, TWIN_DEFAULT_HAND } from "./twin-deck";
import { twinBrowserKeys } from "./twin-keys";
import { createTwinRoomFn } from "./twin-room.functions";
import { TwinDuelApp } from "./TwinDuelApp";

export function TwinApp() {
  const navigate = useNavigate();
  const haptics = useWebHaptics();
  const [duel, setDuel] = useState(false);
  const [name, setName] = useState("");
  const { preferences, set } = useGamePreferences("twin", { handSize: TWIN_DEFAULT_HAND });
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<"friends" | "join" | null>(null);

  if (duel) return <TwinDuelApp onExit={() => setDuel(false)} />;

  const handleCreate = async () => {
    if (!name.trim() || creating) {
      setMessage("Add your name to make a room.");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const room = await createTwinRoomFn({
        data: { hostName: name.trim(), handSize: preferences.handSize },
      });
      sessionStorage.setItem(twinBrowserKeys.invite(room.roomId), room.joinToken);
      writeExpiringLocalValue(
        twinBrowserKeys.playerSession(room.roomId),
        {
          roomId: room.roomId,
          playerId: room.playerId,
          playerToken: room.playerToken,
          expiresAt: room.expiresAt,
          snapshot: room.snapshot,
        },
        room.expiresAt,
      );
      void haptics.trigger("success");
      await navigate({ to: "/things/twin/$roomId", params: { roomId: room.roomId } });
    } catch {
      setCreating(false);
      setMessage("Could not make the room. Check your connection and try again.");
    }
  };

  const handleJoin = async (code = joinCode) => {
    const roomId = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/twin/$roomId", params: { roomId } });
  };

  return (
    <div className="things-game things-game--night twin">
      <header className="twin-header">
        <Link to="/things" className="twin-header-back">
          ← things
        </Link>
        <span className="twin-header-meta">twin</span>
      </header>
      <main id="main" className="twin-launch">
        <GameLaunch
          tone="night"
          eyebrow="spot it first"
          title="Every two cards share exactly one symbol."
          description="Find it before anyone else, put your card down, and empty your hand."
        >
          <GameLaunchButton
            accent="amber"
            onClick={() => {
              setDuel(true);
              void haptics.trigger("selection");
            }}
          >
            two of you, one screen
          </GameLaunchButton>
          <GameLaunchMeta tone="dark">head to head · works offline</GameLaunchMeta>
          <GameLaunchChoices tone="dark">
            <button
              type="button"
              onClick={() => setPanel(panel === "friends" ? null : "friends")}
              aria-pressed={panel === "friends"}
              className="min-h-11"
            >
              everyone on their own phone
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
          <section className="twin-panel" aria-labelledby="twin-friends">
            <h2 id="twin-friends" className="twin-panel-title">
              Everyone on their own phone
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreate();
              }}
              className="twin-panel-form"
            >
              <label className="twin-field twin-field--stacked">
                <span>your name</span>
                <input
                  name="playerName"
                  value={name}
                  maxLength={32}
                  required
                  autoComplete="name"
                  enterKeyHint="go"
                  onChange={(event) => {
                    setName(event.target.value);
                    setMessage(null);
                  }}
                  className="twin-input"
                />
              </label>
              <label className="twin-field twin-field--stacked">
                <span>cards each</span>
                <AppSelect
                  value={preferences.handSize}
                  onValueChange={(value) => set("handSize", Number(value))}
                  ariaLabel="Cards each"
                  tone="night"
                  className="twin-select"
                  options={Array.from(
                    { length: TWIN_MAX_HAND - TWIN_MIN_HAND + 1 },
                    (_unused, index) => {
                      const value = TWIN_MIN_HAND + index;
                      return { value, label: String(value) };
                    },
                  )}
                />
              </label>
              <button type="submit" disabled={creating} className="twin-button twin-button--go">
                {creating ? "making room…" : "create room"}
              </button>
            </form>
            <p className="twin-note">
              The deck grows with the table — more people means more symbols on every card.
            </p>
            {message ? (
              <p role="status" className="twin-message">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}

        {panel === "join" ? (
          <section className="twin-panel" aria-label="Join a room">
            <RoomJoinControl
              value={joinCode}
              gamePath="/things/twin"
              tone="dark"
              message={message}
              onValueChange={(value) => {
                setJoinCode(value);
                setMessage(null);
              }}
              onJoin={handleJoin}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
