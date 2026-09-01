import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { GamePoolLobbyScene } from "./GamePoolLobbyScene";
import { gamePoolPixelWorldGame } from "./lobby-scene";
import { assignGamePoolRoomFn, getGamePoolPublicViewFn } from "./pool.functions";
import {
  adoptGamePoolAssignment,
  forgetGamePoolRoomMembership,
  gamePoolClientId,
  readActiveGamePoolMembership,
} from "./pool-session.client";
import {
  gamePoolPlayerPath,
  requestedGamePoolChoice,
  shouldReplaceExistingGamePoolRoom,
  shouldReturnToExistingGamePoolRoom,
} from "./pool-lobby-policy";
import type { GamePoolPublicView } from "./types";
import { MULTIPLAYER_REALTIME_LIMITS } from "../shared/multiplayer-realtime";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { useRoomReconciler } from "../shared/useRoomReconciler";

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
  const actionInFlight = useRef(false);
  const rooms = view.rooms ?? [];
  const openRooms = rooms.filter(({ status }) => status === "open");
  const game = view.run?.gameSettings.game;
  const activeMembership = game ? readActiveGamePoolMembership(game, token) : null;
  const activeRoomId = activeMembership?.roomId ?? null;
  const activeRoom = activeRoomId ? rooms.find(({ roomId }) => roomId === activeRoomId) : null;
  const requestedRoom = requestedRoomId
    ? rooms.find(({ roomId }) => roomId === requestedRoomId)
    : undefined;
  const requestedRoomAvailable = Boolean(
    requestedRoom &&
    requestedRoom.status === "open" &&
    requestedRoom.playerCount < requestedRoom.capacity,
  );
  const requestedChoice = useMemo(
    () => requestedGamePoolChoice(requestedRoomId, targetRejected),
    [requestedRoomId, targetRejected],
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

  const refreshRoom = useRoomReconciler({
    enabled: Boolean(view.run),
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey: view.run ? `${token}:${view.run.id}` : null,
    reconcile: async () => refresh(),
  });

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/game-pool-ws",
    hello: view.run ? { token, runId: view.run.id } : null,
    onWake: () => void refreshRoom(),
    onTerminal: () => void refreshRoom(),
  });

  useEffect(() => {
    autoJoinChecked.current = false;
    setTargetRejected(false);
  }, [requestedRoomId, token]);

  const assign = useCallback(
    async (choice: "auto" | "new" | { roomId: string }) => {
      if (busy || actionInFlight.current) return;
      const activeRoomId = activeMembership?.roomId ?? null;
      if (
        activeMembership &&
        game &&
        shouldReturnToExistingGamePoolRoom({
          activeRoomId,
          requestedRoomId,
          targetRejected,
          choice,
        })
      ) {
        setBusy(true);
        actionInFlight.current = true;
        window.location.assign(gamePoolPlayerPath(game, activeMembership.roomId));
        return;
      }
      const name = playerName.trim();
      if (!name) {
        setMessage("Add your name first.");
        document.getElementById(nameId)?.focus();
        return;
      }
      actionInFlight.current = true;
      setBusy(true);
      setDestinationRoomId(null);
      setMessage(null);
      const clientId = gamePoolClientId();
      try {
        const assignment = await assignGamePoolRoomFn({
          data: {
            token,
            clientId,
            name,
            choice,
            moveExisting: shouldReplaceExistingGamePoolRoom({
              activeRoomId,
              requestedRoomId,
              targetRejected,
              choice,
            }),
          },
        });
        remember(name);
        adoptGamePoolAssignment(assignment, { token, clientId });
        if (activeRoomId && activeRoomId !== assignment.roomId && game)
          forgetGamePoolRoomMembership(game, activeRoomId);
        setDestinationRoomId(assignment.roomId);
        await showRoomFoundJourney();
        window.location.assign(gamePoolPlayerPath(assignment.game, assignment.roomId));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Could not start playing together. Try again.";
        if (typeof choice === "object" && errorMessage === "That room is no longer available.") {
          setTargetRejected(true);
          setMessage("That room just filled or started. Join the next available room.");
        } else if (errorMessage === "You are already in a room. Choose another room to move.")
          setMessage(
            "You are already in a room. Choose another room below, or start another room.",
          );
        else setMessage(errorMessage);
        setDestinationRoomId(null);
        actionInFlight.current = false;
        setBusy(false);
        await refresh();
      }
    },
    [
      activeMembership,
      busy,
      game,
      nameId,
      playerName,
      refresh,
      remember,
      requestedRoomId,
      targetRejected,
      token,
    ],
  );

  useEffect(() => {
    if (!nameLoaded || autoJoinChecked.current) return;
    autoJoinChecked.current = true;
    if (
      suppressAutoJoin ||
      !view.run?.autoJoin ||
      view.run.status !== "open" ||
      view.message ||
      !playerName.trim() ||
      (activeRoomId && !requestedRoomId && !targetRejected)
    )
      return;
    void assign(requestedChoice);
  }, [
    activeRoomId,
    assign,
    nameLoaded,
    playerName,
    requestedChoice,
    requestedRoomId,
    suppressAutoJoin,
    targetRejected,
    view.message,
    view.run,
  ]);

  if (!view.found)
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-2xl items-center px-6 py-16">
        <div>
          <h1 className="font-serif text-4xl font-semibold">This link is not active.</h1>
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
  const returningToActiveRoom = Boolean(activeMembership && !requestedRoomId && !targetRejected);
  const joiningNextRoom = Boolean(targetRejected);
  const joiningRequestedRoom = Boolean(requestedRoomId && !targetRejected);
  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-12 sm:py-20">
      <header>
        <h1 className="font-serif text-5xl font-semibold tracking-tight">
          {returningToActiveRoom
            ? "welcome back"
            : joiningNextRoom
              ? "That room just filled. Choose the next available room below."
              : joiningRequestedRoom
                ? "join the invited room"
                : activeRoom
                  ? "choose another room"
                  : (view.entrance?.label ?? "join a game")}
        </h1>
        <p className="mt-4 max-w-lg font-serif text-lg leading-relaxed theme-subtle">
          {returningToActiveRoom
            ? `You are already in ${activeRoom?.label ?? "your room"}. Continue to go back, or choose another room below.`
            : joiningRequestedRoom && requestedRoomAvailable && requestedRoom
              ? `This invite is for ${requestedRoom.label}. Add your name and go straight in.`
              : joiningRequestedRoom
                ? "This invite is for one specific room. Add your name and go straight in."
                : activeRoom
                  ? `You are still in ${activeRoom.label}. Choose another room to leave it and move.`
                  : requestedRoomId
                    ? "That room is no longer available. We can place you in the next room."
                    : "Add your name. We will place you in a room that is ready for another player."}
        </p>
      </header>

      {view.scoring ? (
        <aside className="mt-8 border-y theme-border py-5" aria-label="Event points">
          <p className="font-mono text-xs uppercase tracking-widest theme-muted">event points</p>
          <p className="mt-2 font-serif text-lg leading-relaxed">
            Finish the game for {view.scoring.completionPoints} points. Win for{" "}
            {view.scoring.winnerTotalPoints} points total.
          </p>
          <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
            {view.scoring.eligible
              ? "Your event ticket is connected on this phone. Points will be added automatically."
              : "You can still play, but this phone has no event ticket connected, so this game will not add points."}
          </p>
        </aside>
      ) : null}

      {activeMembership && game ? (
        <section className="mt-8 border-y theme-border py-6" aria-labelledby="return-to-room-title">
          <p className="font-mono text-micro theme-muted tracking-widest uppercase">your room</p>
          <h2 id="return-to-room-title" className="mt-2 font-serif text-2xl font-semibold">
            Return to your game
          </h2>
          <p className="mt-3 max-w-lg font-mono text-sm leading-relaxed theme-muted">
            You are already playing in {activeRoom?.label ?? "a room"}. You do not need to enter
            your name again.
          </p>
          <a
            href={gamePoolPlayerPath(game, activeMembership.roomId)}
            className="mt-5 inline-flex min-h-12 items-center rounded-full bg-[var(--foreground)] px-6 font-mono text-sm font-semibold text-[var(--background)] transition-opacity hover:opacity-85"
          >
            return to my room
          </a>
        </section>
      ) : null}

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
            {joiningRequestedRoom && requestedRoomAvailable && requestedRoom
              ? `Join ${requestedRoom.label}`
              : joiningRequestedRoom
                ? "Join the invited room"
                : requestedRoomId
                  ? "Join the next room"
                  : joiningNextRoom
                    ? "Join the next room"
                    : returningToActiveRoom
                      ? "Return to your room"
                      : activeRoom
                        ? "Choose another room"
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
            disabled={busy || (!returningToActiveRoom && !nameLoaded)}
            className="mt-8 min-h-14 w-full rounded-full bg-[var(--foreground)] px-6 font-mono text-sm font-semibold text-[var(--background)] transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {busy
              ? "finding a room…"
              : joiningRequestedRoom && requestedRoomAvailable && requestedRoom
                ? `join ${requestedRoom.label}`
                : joiningRequestedRoom
                  ? "join invited room"
                  : requestedRoomId
                    ? "join next available room"
                    : joiningNextRoom
                      ? "join next available room"
                      : returningToActiveRoom
                        ? "return to my room"
                        : activeRoom
                          ? "leave current room and find another"
                          : "play together"}
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
          {joiningRequestedRoom ? (
            <p className="mt-4 font-mono text-micro leading-relaxed theme-faint">
              This invite takes you to one specific room.
            </p>
          ) : requestedRoomAvailable ? (
            <p className="mt-4 font-mono text-micro leading-relaxed theme-faint">
              This is a shared room. Everyone who joins plays together.
            </p>
          ) : activeRoom ? (
            <p className="mt-4 font-mono text-micro leading-relaxed theme-faint">
              Choosing another room releases your current seat first.
            </p>
          ) : null}
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
