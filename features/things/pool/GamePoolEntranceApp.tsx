import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { GamePoolLobbyScene } from "./GamePoolLobbyScene";
import { gamePoolPixelWorldGame } from "./lobby-scene";
import { assignGamePoolRoomFn, getGamePoolPublicViewFn } from "./pool.functions";
import {
  adoptGamePoolAssignment,
  gamePoolClientId,
  gamePoolPlayerPath,
} from "./pool-session.client";
import type { GamePoolPublicView } from "./types";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";

function showRoomFoundJourney() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, 420));
}

export function GamePoolEntranceApp({
  token,
  initialView,
  requestedRoomId,
  suppressAutoJoin = false,
}: {
  token: string;
  initialView: GamePoolPublicView;
  requestedRoomId?: string;
  suppressAutoJoin?: boolean;
}) {
  const nameId = useId();
  const messageId = useId();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [destinationRoomId, setDestinationRoomId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialView.message ?? null);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [targetRejected, setTargetRejected] = useState(false);
  const { loaded: nameLoaded, name: playerName, remember, setName } = useRememberedPlayerName(32);
  const autoJoinChecked = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const rooms = view.rooms ?? [];
  const openRooms = rooms.filter(({ status }) => status === "open");
  const requestedRoom = requestedRoomId
    ? rooms.find(({ roomId }) => roomId === requestedRoomId)
    : undefined;
  const requestedRoomAvailable = Boolean(
    requestedRoom &&
    requestedRoom.status === "open" &&
    requestedRoom.playerCount < requestedRoom.capacity,
  );
  const requestedChoice = useMemo(
    () =>
      requestedRoomId && requestedRoomAvailable && !targetRejected
        ? ({ roomId: requestedRoomId } as const)
        : ("auto" as const),
    [requestedRoomAvailable, requestedRoomId, targetRejected],
  );

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
    onTerminal: () => void refreshRef.current(),
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

  const assign = useCallback(
    async (choice: "auto" | "new" | { roomId: string }) => {
      if (busy) return;
      const name = playerName.trim();
      if (!name) {
        setMessage("Add your name first.");
        document.getElementById(nameId)?.focus();
        return;
      }
      setBusy(true);
      setDestinationRoomId(null);
      setMessage(null);
      const clientId = gamePoolClientId();
      try {
        const assignment = await assignGamePoolRoomFn({
          data: { token, clientId, name, choice },
        });
        remember(name);
        adoptGamePoolAssignment(assignment, { token, clientId });
        setDestinationRoomId(assignment.roomId);
        await showRoomFoundJourney();
        window.location.assign(gamePoolPlayerPath(assignment));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Could not find a room. Try again.";
        if (typeof choice === "object" && errorMessage === "That room is no longer available.") {
          setTargetRejected(true);
          setMessage("That room just filled or started. Join the next available room.");
        } else setMessage(errorMessage);
        setDestinationRoomId(null);
        setBusy(false);
        await refresh();
      }
    },
    [busy, nameId, playerName, refresh, remember, token],
  );

  useEffect(() => {
    if (!nameLoaded || autoJoinChecked.current) return;
    autoJoinChecked.current = true;
    if (
      suppressAutoJoin ||
      !view.run?.autoJoin ||
      view.run.status !== "open" ||
      view.message ||
      !playerName.trim()
    )
      return;
    void assign(requestedChoice);
  }, [assign, nameLoaded, playerName, requestedChoice, suppressAutoJoin, view.message, view.run]);

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
  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-12 sm:py-20">
      <header>
        <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">game night</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold tracking-tight">
          {view.entrance?.label ?? "join a game"}
        </h1>
        <p className="mt-4 max-w-lg font-serif text-lg leading-relaxed theme-subtle">
          {requestedRoomAvailable && requestedRoom
            ? `This invite is for ${requestedRoom.label}. Add your name and go straight in.`
            : requestedRoomId
              ? "That room is no longer available. We can place you in the next room."
              : "Add your name. We will place you in a room that is ready for another player."}
        </p>
      </header>

      {accepting && view.run ? (
        <GamePoolLobbyScene
          allowNewRooms={view.run.allowNewRooms}
          allowRoomChoice={view.run.allowRoomChoice}
          busy={busy}
          destinationRoomId={destinationRoomId}
          game={gamePoolPixelWorldGame(view.run.gameSettings)}
          joining={busy}
          live={socket.state === "connected"}
          onChooseRoom={(roomId) => void assign({ roomId })}
          requestedRoomId={requestedRoomId}
          rooms={rooms}
          targetSize={view.run.targetSize}
        />
      ) : null}

      {accepting ? (
        <form
          className="mt-8 border-t theme-border pt-8"
          aria-labelledby="join-title"
          onSubmit={(event) => {
            event.preventDefault();
            void assign(requestedChoice);
          }}
        >
          <h2 id="join-title" className="font-serif text-2xl font-semibold">
            {requestedRoomAvailable && requestedRoom
              ? `Join ${requestedRoom.label}`
              : requestedRoomId
                ? "Join the next room"
                : "Enter the lobby"}
          </h2>
          <label htmlFor={nameId} className="mt-6 block font-mono text-xs theme-muted">
            your name
          </label>
          <input
            id={nameId}
            name="playerName"
            value={playerName}
            maxLength={32}
            autoComplete="name"
            aria-invalid={message === "Add your name first." || undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setMessage(null);
            }}
            className="mt-2 min-h-12 w-full border-b theme-border bg-transparent py-2 font-serif text-2xl outline-none focus:border-[var(--foreground)]"
          />
          <button
            type="submit"
            disabled={busy || !nameLoaded}
            className="mt-8 min-h-14 w-full rounded-full bg-[var(--foreground)] px-6 font-mono text-sm font-semibold text-[var(--background)] transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {busy
              ? "finding a room…"
              : requestedRoomAvailable && requestedRoom
                ? `join ${requestedRoom.label}`
                : requestedRoomId
                  ? "join next available room"
                  : "find me a room"}
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
          <p className="mt-4 font-mono text-micro leading-relaxed theme-faint">
            {requestedRoomAvailable
              ? "This room QR still uses game-night admission, so seats and rejoining stay safe."
              : "We remember your name on this device. Repeat scans can return you to your room immediately."}
          </p>
        </form>
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
                      {room.occupants.some(({ label }) => label)
                        ? room.occupants.flatMap(({ label }) => (label ? [label] : [])).join(", ")
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
