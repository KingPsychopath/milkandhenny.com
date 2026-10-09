import { Link, useNavigate } from "@tanstack/react-router";
import { GameFrame, GameFrameHeader } from "../shared/GameFrame";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
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
} from "./pool-lobby-policy";
import type { GamePoolJoinChoice } from "./pool-lobby-policy";
import type { GamePoolPublicView } from "./types";
import { MULTIPLAYER_REALTIME_LIMITS } from "../shared/multiplayer-realtime";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { useRoomReconciler } from "../shared/useRoomReconciler";

export function GamePoolEntranceApp({
  token,
  initialView,
  requestedRoomId,
}: {
  token: string;
  initialView: GamePoolPublicView;
  requestedRoomId?: string;
}) {
  const navigate = useNavigate();
  const messageId = useId();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialView.message ?? null);
  const [targetRejected, setTargetRejected] = useState(false);
  const { loaded: nameLoaded, name: playerName, remember } = useRememberedPlayerName(32);
  const actionInFlight = useRef(false);
  const assignmentRequest = useRef<AbortController | null>(null);
  const reconciliation = useRef<AbortController | null>(null);
  const [reconciliationStopped, setReconciliationStopped] = useState(false);
  const rooms = view.rooms ?? [];
  const game = view.run?.gameSettings.game;
  const activeMembership = game ? readActiveGamePoolMembership(game, token) : null;
  const activeRoomId = activeMembership?.roomId ?? null;
  const accepting = view.run?.status === "open" && !view.message;

  useEffect(() => setTargetRejected(false), [requestedRoomId, token]);
  useEffect(() => setView(initialView), [initialView]);
  useEffect(() => {
    setReconciliationStopped(false);
    setBusy(false);
    actionInFlight.current = false;
    return () => {
      reconciliation.current?.abort();
      assignmentRequest.current?.abort();
    };
  }, [requestedRoomId, token]);
  const refreshRoom = useRoomReconciler({
    enabled: Boolean(view.run) && !reconciliationStopped,
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey: view.run ? `${token}:${view.run.id}` : null,
    reconcile: async (isCurrent) => {
      const controller = new AbortController();
      reconciliation.current = controller;
      try {
        const next = await getGamePoolPublicViewFn({
          data: { token },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (isCurrent()) setView(next);
      } catch (cause) {
        if (!isCurrent() || controller.signal.aborted) return;
        const status =
          typeof cause === "object" && cause !== null && "status" in cause
            ? cause.status
            : undefined;
        if (typeof status === "number" && status >= 400 && status < 500)
          setReconciliationStopped(true);
      } finally {
        if (reconciliation.current === controller) reconciliation.current = null;
      }
    },
  });
  useMultiplayerWakeSocket({
    path: "/api/things/game-pool-ws",
    hello: view.run ? { token, runId: view.run.id } : null,
    onWake: () => void refreshRoom(),
    onTerminal: () => void refreshRoom(),
  });

  const assign = useCallback(
    async (choice: GamePoolJoinChoice) => {
      if (actionInFlight.current || !playerName.trim()) return;
      actionInFlight.current = true;
      setBusy(true);
      setMessage(null);
      const clientId = gamePoolClientId();
      const controller = new AbortController();
      assignmentRequest.current = controller;
      try {
        const assignment = await assignGamePoolRoomFn({
          data: {
            token,
            clientId,
            name: playerName.trim(),
            choice,
            moveExisting: shouldReplaceExistingGamePoolRoom({
              activeRoomId,
              requestedRoomId,
              targetRejected,
              choice,
            }),
          },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        // A late assignment must never pull someone back after they have left the entrance.
        if (controller.signal.aborted) return;
        remember(playerName.trim());
        adoptGamePoolAssignment(assignment, { token, clientId });
        if (activeRoomId && activeRoomId !== assignment.roomId && game)
          forgetGamePoolRoomMembership(game, activeRoomId);
        // Keep the entrance in history so Back always returns to a chooser, never an auto-join loop.
        await navigate({ to: gamePoolPlayerPath(assignment.game, assignment.roomId) });
      } catch (cause) {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : "Could not join. Try again.";
        if (typeof choice === "object" && error === "That room is no longer available.") {
          setTargetRejected(true);
          setMessage("That room is full or playing. Choose another room.");
        } else setMessage(error);
      } finally {
        if (assignmentRequest.current === controller) {
          assignmentRequest.current = null;
          actionInFlight.current = false;
          if (!controller.signal.aborted) setBusy(false);
        }
      }
    },
    [activeRoomId, game, navigate, playerName, remember, requestedRoomId, targetRejected, token],
  );

  return (
    <GameFrame>
      <GameFrameHeader className="flex items-center">
        <Link to="/things" className="mh-action mh-action--quiet">
          ← all games
        </Link>
      </GameFrameHeader>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-6 pb-16 pt-6">
        <h1 className="font-serif text-4xl font-semibold sm:text-5xl">
          {view.found ? (view.entrance?.label ?? "Game night") : "This invite has ended."}
        </h1>
        {view.found ? (
          <>
            <p className="mt-4 font-serif text-lg theme-muted">
              {accepting
                ? "Join a room, then start when everyone is ready."
                : (view.message ?? "New joins are paused.")}
            </p>
            {activeMembership && game ? (
              <section className="mt-8 border-y theme-border py-5">
                <Link
                  to={gamePoolPlayerPath(game, activeMembership.roomId)}
                  className="mh-action mh-action--primary w-full"
                >
                  return to my room
                </Link>
              </section>
            ) : null}
            {accepting ? (
              <section className="mt-8" aria-label="Join a game">
                <p className="mb-4 font-mono text-xs theme-muted">
                  joining as {playerName || "guest"}
                </p>
                <button
                  type="button"
                  disabled={busy || !nameLoaded}
                  onClick={() =>
                    void assign(requestedGamePoolChoice(requestedRoomId, targetRejected))
                  }
                  className="mh-action mh-action--primary w-full"
                  aria-describedby={message ? messageId : undefined}
                >
                  {busy
                    ? "joining…"
                    : requestedRoomId && !targetRejected
                      ? "join invited room"
                      : activeMembership
                        ? "find another room"
                        : "join a room"}
                </button>
                {view.run?.allowNewRooms ? (
                  <button
                    type="button"
                    disabled={busy || !nameLoaded}
                    onClick={() => void assign("new")}
                    className="mh-action mh-action--secondary mt-3 w-full"
                  >
                    new room
                  </button>
                ) : null}
                {message ? (
                  <p id={messageId} role="status" className="mt-4 font-mono text-xs theme-muted">
                    {message}
                  </p>
                ) : null}
              </section>
            ) : null}
            {accepting && view.run?.allowRoomChoice && rooms.length ? (
              <section className="mt-10" aria-labelledby="rooms-heading">
                <h2 id="rooms-heading" className="font-mono text-xs theme-muted">
                  rooms
                </h2>
                <ul className="mt-3 divide-y theme-border border-y theme-border">
                  {rooms
                    .filter(({ status }) => status !== "closed")
                    .map((room) => (
                      <li
                        key={room.roomId}
                        className="flex items-center justify-between gap-4 py-4"
                      >
                        <div className="min-w-0">
                          <p className="font-serif text-xl">{room.label}</p>
                          <p className="mt-1 font-mono text-xs theme-muted">
                            {room.playerCount}/{room.capacity} players ·{" "}
                            {room.status === "open" ? "waiting" : "playing"}
                          </p>
                        </div>
                        {room.roomId === activeRoomId && game ? (
                          <Link
                            to={gamePoolPlayerPath(game, room.roomId)}
                            className="mh-action mh-action--quiet"
                          >
                            return
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled={
                              busy ||
                              !nameLoaded ||
                              room.status !== "open" ||
                              room.playerCount >= room.capacity
                            }
                            onClick={() => void assign({ roomId: room.roomId })}
                            className="mh-action mh-action--quiet"
                          >
                            join
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <p className="mt-4 font-serif text-lg theme-muted">Ask the organiser for a new invite.</p>
        )}
      </main>
    </GameFrame>
  );
}
