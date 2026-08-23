import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { joinDrawCountryRoomFn } from "./draw-country-room.functions";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { captureDrawCountryInvite } from "./invite.client";
import type { DrawCountryPlayerCredentials } from "./types";

export function JoinDrawCountryRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
  onJoined: (credentials: DrawCountryPlayerCredentials) => void;
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
      const result = await joinDrawCountryRoomFn({
        data: { roomId, joinToken: captureDrawCountryInvite(roomId), name: name.trim() },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        setEditingName(true);
        return;
      }
      const credentials: DrawCountryPlayerCredentials = {
        roomId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      };
      remember(name);
      writeExpiringLocalValue(
        drawCountryBrowserKeys.playerSession(roomId),
        credentials,
        result.expiresAt,
      );
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
    <div className="things-game things-game--cream text-black">
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-4 font-mono text-xs text-black/50">
        <Link to="/things/draw-country" className="inline-flex min-h-11 items-center">
          ← game
        </Link>
        <span className="tracking-[0.16em]">{roomId}</span>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-20"
      >
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
          shared room
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">Ready to draw?</h1>
        {loaded && name && !editingName ? (
          <div className="mt-8">
            <p className="font-mono text-xs text-black/55">joining as</p>
            <p className="mt-2 font-serif text-3xl">{name}</p>
            <button
              type="button"
              onClick={() => void handleJoin()}
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
              void handleJoin();
            }}
          >
            <label className="mt-8 block font-mono text-xs text-black/55">
              <span className="block pb-2">your name</span>
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
                /* text-base keeps iOS Safari from zooming the page on focus — this
                 input autofocuses, so a smaller size zooms the invite link on arrival. */
                className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-5 text-base text-black"
              />
            </label>
            <button
              type="submit"
              disabled={!name.trim() || joining}
              className="mt-4 min-h-12 w-full rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-35"
            >
              {joining ? "joining…" : "join room"}
            </button>
            {message ? (
              <p role="alert" className="mt-4 font-mono text-xs text-amber-800">
                {message}
              </p>
            ) : null}
          </form>
        )}
      </main>
    </div>
  );
}
