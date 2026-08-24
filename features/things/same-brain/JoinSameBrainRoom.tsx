import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { GameShell } from "../shared/GameShell";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { SAME_BRAIN_MAX_NAME_LENGTH } from "./same-brain-rules";
import { joinSameBrainRoomFn } from "./same-brain-room.functions";
import { captureSameBrainInvite } from "./invite.client";
import type { SameBrainPlayerCredentials } from "./types";
import { ThingsRoomHeader } from "../shared/RoomHeader";

export function JoinSameBrainRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
  onJoined: (credentials: SameBrainPlayerCredentials) => void;
}) {
  const { loaded, name, setName, remember } = useRememberedPlayerName(SAME_BRAIN_MAX_NAME_LENGTH);
  const [joining, setJoining] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinSameBrainRoomFn({
        data: {
          roomId,
          joinToken: captureSameBrainInvite(roomId),
          name: name.trim(),
          joinId: `${roomId}:${name.trim().toLocaleLowerCase()}`,
        },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        setEditingName(true);
        return;
      }
      remember(name);
      onJoined({
        roomId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      });
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
    <GameShell tone="night">
      <div className="flex min-h-0 flex-1 flex-col text-white">
        <ThingsRoomHeader
          tone="night"
          back={<Link to="/things/same-brain">← same brain</Link>}
          roomId={roomId}
        />
        <main
          id="main"
          className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-20"
        >
          <h1 className="font-serif text-5xl font-semibold">Who are you?</h1>
          {loaded && name && !editingName ? (
            <div className="mt-8">
              <p className="font-mono text-xs text-white/55">joining as</p>
              <p className="mt-2 font-serif text-3xl">{name}</p>
              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joining}
                className="mt-6 min-h-12 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-40"
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
              <label className="mt-8 block font-mono text-xs text-white/55">
                <span className="block pb-2">your name</span>
                <input
                  name="playerName"
                  value={name}
                  maxLength={SAME_BRAIN_MAX_NAME_LENGTH}
                  required
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                  className="min-h-14 w-full border-b border-white/25 bg-transparent font-serif text-3xl text-white outline-none focus-visible:border-[var(--things-amber)]"
                />
              </label>
              <button
                type="submit"
                disabled={!name.trim() || joining}
                className="mt-10 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black transition-transform hover:scale-[1.01] disabled:scale-100 disabled:opacity-40"
              >
                {joining ? "joining…" : "join the room"}
              </button>
            </form>
          )}
          {message ? (
            <p className="mt-5 font-mono text-xs text-[var(--things-amber)]" role="status">
              {message}
            </p>
          ) : null}
        </main>
      </div>
    </GameShell>
  );
}
