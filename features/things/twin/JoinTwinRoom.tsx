import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { captureTwinInvite } from "./invite.client";
import { twinBrowserKeys } from "./twin-keys";
import { joinTwinRoomFn } from "./twin-room.functions";
import type { TwinPlayerCredentials } from "./types";

export function JoinTwinRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
  onJoined: (credentials: TwinPlayerCredentials) => void;
}) {
  const { loaded, name, setName, remember } = useRememberedPlayerName(32);
  const [joining, setJoining] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinTwinRoomFn({
        data: { roomId, joinToken: captureTwinInvite(roomId), name: name.trim() },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        setEditingName(true);
        return;
      }
      const credentials: TwinPlayerCredentials = {
        roomId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      };
      remember(name);
      writeExpiringLocalValue(twinBrowserKeys.playerSession(roomId), credentials, result.expiresAt);
      onJoined(credentials);
    } catch {
      setMessage("Could not join. Check your connection and try again.");
      setJoining(false);
      setEditingName(true);
    }
  }, [joining, name, onJoined, remember, roomId]);

  const changeName = () => {
    if (joining) return;
    setEditingName(true);
    setMessage(null);
  };

  return (
    <div className="things-game things-game--night twin">
      <header className="twin-header">
        <Link to="/things/twin" className="twin-header-back">
          ← game
        </Link>
        <span className="twin-header-meta">{roomId}</span>
      </header>
      <main id="main" className="twin-join">
        <p className="twin-eyebrow">shared room</p>
        <h1 className="twin-title">Sharp eyes?</h1>
        {loaded && name && !editingName ? (
          <div className="mt-8">
            <p className="twin-field">
              <span>joining as</span>
            </p>
            <p className="mt-2 font-serif text-3xl">{name}</p>
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={joining}
              className="twin-button twin-button--go mt-6 w-full disabled:opacity-40"
            >
              {joining ? "joining…" : `join as ${name}`}
            </button>
            <button
              type="button"
              onClick={changeName}
              disabled={joining}
              className="mt-3 min-h-11 font-mono text-xs underline underline-offset-4 disabled:opacity-40"
            >
              change name
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleJoin();
            }}
          >
            <label className="twin-field twin-field--stacked">
              <span>your name</span>
              <input
                name="playerName"
                value={name}
                maxLength={32}
                required
                autoFocus
                autoComplete="name"
                enterKeyHint="go"
                onChange={(event) => {
                  setName(event.target.value);
                  setMessage(null);
                }}
                /* text-base keeps iOS Safari from zooming the page on focus — this input autofocuses,
                 so anything smaller zooms the invite link on arrival. */
                className="twin-input"
              />
            </label>
            <button
              type="submit"
              disabled={!name.trim() || joining}
              className="twin-button twin-button--go"
            >
              {joining ? "joining…" : "join room"}
            </button>
            {message ? (
              <p role="alert" className="twin-message">
                {message}
              </p>
            ) : null}
          </form>
        )}
      </main>
    </div>
  );
}
