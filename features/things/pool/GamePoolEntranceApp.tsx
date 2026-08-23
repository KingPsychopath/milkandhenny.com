import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { assignGamePoolRoomFn, getGamePoolPublicViewFn } from "./pool.functions";
import {
  adoptGamePoolAssignment,
  gamePoolClientId,
  gamePoolPlayerPath,
} from "./pool-session.client";
import type { GamePoolPublicView } from "./types";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";

export function GamePoolEntranceApp({
  token,
  initialView,
}: {
  token: string;
  initialView: GamePoolPublicView;
}) {
  const nameId = useId();
  const messageId = useId();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialView.message ?? null);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const remembered = useRememberedPlayerName(32);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await getGamePoolPublicViewFn({ data: { token } });
      setView(next);
      if (!next.run || next.run.status !== "open") setMessage(next.message ?? null);
    } catch {
      // The current view remains useful during a short network failure.
    }
  }, [token]);
  refreshRef.current = refresh;

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/game-pool-ws",
    hello: view.run ? { token, runId: view.run.id } : null,
    onWake: () => void refreshRef.current(),
  });

  useEffect(() => {
    const interval = window.setInterval(() => void refreshRef.current(), 5_000);
    const resume = () => {
      if (!document.hidden) void refreshRef.current();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const assign = async (choice: "auto" | "new" | { roomId: string }) => {
    if (busy) return;
    const name = remembered.name.trim();
    if (!name) {
      setMessage("Add your name first.");
      document.getElementById(nameId)?.focus();
      return;
    }
    setBusy(true);
    setMessage(null);
    const clientId = gamePoolClientId();
    try {
      const assignment = await assignGamePoolRoomFn({
        data: { token, clientId, name, choice },
      });
      remembered.remember(name);
      adoptGamePoolAssignment(assignment, { token, clientId });
      window.location.assign(gamePoolPlayerPath(assignment));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not find a room. Try again.");
      setBusy(false);
      await refresh();
    }
  };

  if (!view.found)
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-2xl items-center px-6 py-16">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">game night</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold">This link is not active.</h1>
          <p className="mt-4 max-w-md font-mono text-sm leading-relaxed theme-muted">
            Ask the organiser for the current game QR code.
          </p>
          <Link
            to="/things"
            className="mt-8 inline-flex min-h-11 items-center font-mono text-xs underline"
          >
            browse games
          </Link>
        </div>
      </main>
    );

  const accepting = view.run?.status === "open" && !view.message;
  const rooms = view.rooms ?? [];
  const openRooms = rooms.filter(({ status }) => status === "open");

  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-12 sm:py-20">
      <header>
        <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">game night</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold tracking-tight">
          {view.entrance?.label ?? "join a game"}
        </h1>
        <p className="mt-4 max-w-lg font-serif text-lg leading-relaxed theme-subtle">
          Add your name. We will place you in a room that is ready for another player.
        </p>
      </header>

      {accepting ? (
        <section className="mt-10 border-t theme-border pt-8" aria-labelledby="join-title">
          <h2 id="join-title" className="font-serif text-2xl font-semibold">
            Join the game
          </h2>
          <label htmlFor={nameId} className="mt-6 block font-mono text-xs theme-muted">
            your name
          </label>
          <input
            id={nameId}
            value={remembered.name}
            maxLength={32}
            autoComplete="name"
            aria-invalid={message === "Add your name first." || undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => {
              remembered.setName(event.target.value);
              setMessage(null);
            }}
            className="mt-2 min-h-12 w-full border-b theme-border bg-transparent py-2 font-serif text-2xl outline-none focus:border-[var(--foreground)]"
          />
          <button
            type="button"
            disabled={busy || !remembered.loaded}
            onClick={() => void assign("auto")}
            className="mt-8 min-h-14 w-full rounded-full bg-[var(--foreground)] px-6 font-mono text-sm font-semibold text-[var(--background)] transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {busy ? "finding a room…" : "find me a room"}
          </button>
          {view.run?.allowNewRooms ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void assign("new")}
              className="mt-3 min-h-12 w-full rounded-full border theme-border px-6 font-mono text-xs transition-opacity hover:opacity-70 disabled:opacity-50"
            >
              start another room
            </button>
          ) : null}
          {message ? (
            <p
              id={messageId}
              role="status"
              className="mt-4 font-mono text-xs text-[var(--prose-hashtag)]"
            >
              {message}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="mt-10 border-t theme-border pt-8" aria-live="polite">
          <h2 className="font-serif text-2xl font-semibold">Not open right now</h2>
          <p className="mt-3 font-mono text-sm leading-relaxed theme-muted">
            {view.message ?? "The organiser has paused new joins."}
          </p>
        </section>
      )}

      {accepting && view.run?.allowRoomChoice && rooms.length > 0 ? (
        <section className="mt-8 border-t theme-border pt-6">
          <button
            type="button"
            aria-expanded={roomsOpen}
            onClick={() => setRoomsOpen((current) => !current)}
            className="flex min-h-11 w-full items-center justify-between font-mono text-xs theme-muted"
          >
            <span>choose a room ({openRooms.length} waiting)</span>
            <span aria-hidden="true">{roomsOpen ? "−" : "+"}</span>
          </button>
          {roomsOpen ? (
            <ul className="mt-3 divide-y theme-border-faint">
              {rooms.map((room) => (
                <li key={room.roomId} className="flex items-center justify-between gap-5 py-4">
                  <div className="min-w-0">
                    <p className="font-mono text-sm">{room.label}</p>
                    <p className="mt-1 truncate font-mono text-xs theme-muted">
                      {room.players.length > 0
                        ? room.players.join(", ")
                        : `${room.playerCount} joined`}
                      {` · ${room.playerCount} of ${room.capacity}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || room.status !== "open"}
                    onClick={() => void assign({ roomId: room.roomId })}
                    className="min-h-11 shrink-0 px-2 font-mono text-xs underline disabled:no-underline disabled:opacity-40"
                  >
                    {room.status === "open" ? "join" : "playing"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-14 border-t theme-border pt-5">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/things"
            className="inline-flex min-h-11 items-center font-mono text-xs theme-muted"
          >
            other games
          </Link>
          <span
            className="font-mono text-micro theme-muted"
            aria-label={`live updates ${socket.state}`}
          >
            {socket.state === "connected" ? "live" : "refreshing"}
          </span>
        </div>
      </footer>
    </main>
  );
}
