import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { centreBrowserKeys } from "./centre-keys";
import { joinCentreRoomFn } from "./centre-room.functions";
import { captureCentreInvite } from "./invite.client";
import type { CentrePlayerCredentials } from "./types";

export function JoinCentreRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
  onJoined: (credentials: CentrePlayerCredentials) => void;
}) {
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const join = async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinCentreRoomFn({
        data: { roomId, joinToken: captureCentreInvite(roomId), name: name.trim() },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        return;
      }
      const credentials: CentrePlayerCredentials = {
        roomId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      };
      writeExpiringLocalValue(
        centreBrowserKeys.playerSession(roomId),
        credentials,
        result.expiresAt,
      );
      onJoined(credentials);
    } catch {
      setMessage("Could not join. Check your connection and try again.");
      setJoining(false);
    }
  };

  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <Link to="/things/centre">← game</Link>
        <span>{roomId}</span>
      </header>
      <main id="main" className="centre-join">
        <p className="centre-eyebrow">shared race</p>
        <h1 className="centre-title">Ready to find the centre?</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label className="centre-field">
            <span>your name</span>
            <input
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
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || joining}
            className="centre-button centre-button--go"
          >
            {joining ? "joining…" : "join race"}
          </button>
          {message ? (
            <p role="alert" className="centre-message">
              {message}
            </p>
          ) : null}
        </form>
      </main>
    </div>
  );
}
