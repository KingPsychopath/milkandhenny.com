import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { centreBrowserKeys } from "./centre-keys";
import { joinCentreRoomFn } from "./centre-room.functions";
import { captureCentreInvite } from "./invite.client";
import type { CentrePlayerCredentials } from "./types";
import { useAutomaticRoomJoin, useMultiplayerJoinAttempt } from "../shared/multiplayer-join.client";
import { useSafeGameNavigation } from "../shared/useSafeGameNavigation";

export function JoinCentreRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
  onJoined: (credentials: CentrePlayerCredentials) => void;
}) {
  useSafeGameNavigation(true);
  const { loaded, name, setName, remember } = useRememberedPlayerName(32);
  const [joining, setJoining] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const joinAttempt = useMultiplayerJoinAttempt("centre", 1, roomId);

  const join = useCallback(async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinCentreRoomFn({
        data: {
          roomId,
          joinToken: captureCentreInvite(roomId),
          name: name.trim(),
          ...joinAttempt.attempt,
        },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        setEditingName(true);
        return;
      }
      const credentials: CentrePlayerCredentials = {
        roomId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      };
      remember(name);
      joinAttempt.clear();
      writeExpiringLocalValue(
        centreBrowserKeys.playerSession(roomId),
        credentials,
        result.expiresAt,
      );
      onJoined(credentials);
    } catch {
      setMessage("Could not join. Check your connection and try again.");
      setJoining(false);
      setEditingName(true);
    }
  }, [joinAttempt, joining, name, onJoined, remember, roomId]);

  const changeName = () => {
    if (joining) return;
    setEditingName(true);
    setMessage(null);
  };
  useAutomaticRoomJoin(loaded && Boolean(name.trim()), join);

  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <Link to="/things/centre">← game</Link>
        <span>{roomId}</span>
      </header>
      <main id="main" className="centre-join">
        <p className="centre-eyebrow">shared race</p>
        <h1 className="centre-title">Ready to find the centre?</h1>
        {loaded && name && !editingName ? (
          <div className="mt-8">
            <p className="font-mono text-xs text-black/55">joining as</p>
            <p className="mt-2 font-serif text-3xl">{name}</p>
            <button
              type="button"
              onClick={() => void join()}
              disabled={joining}
              className="mt-6 min-h-12 w-full rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40"
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
              void join();
            }}
          >
            <label className="centre-field">
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
                  setEditingName(true);
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
        )}
      </main>
    </div>
  );
}
