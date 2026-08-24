import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { AppImage } from "@/components/AppImage";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { useQrCode } from "@/hooks/useQrCode";
import { useWakeLock } from "@/hooks/useWakeLock";
import { shareOrCopy } from "@/lib/client/share";
import { GameActionDialog } from "../shared/GameActionDialog";
import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { gameBrowserKey } from "../shared/multiplayer-keys";
import type { MultiplayerActionInput } from "../shared/multiplayer";
import { useGameSound } from "../shared/useGameSound";
import { buildCentrePlayerInviteUrl } from "./centre-invite";
import { centreBrowserKeys } from "./centre-keys";
import { applyCentreActionFn, readCentreReplayFn } from "./centre-room.functions";
import { playCentreSound, primeCentreAudio } from "./centre-sound.client";
import { CentreReplay } from "./CentreReplay";
import { generateCentreMaze, centreEntrancePoint } from "./centre-generator";
import { JoinCentreRoom } from "./JoinCentreRoom";
import { MazeBoard } from "./MazeBoard";
import { captureCentreInvite } from "./invite.client";
import type {
  CentreAction,
  CentreDifficulty,
  CentrePlayerCredentials,
  CentreReplayPlayer,
  CentreRoute,
} from "./types";
import { useCentreRoom } from "./useCentreRoom";
import {
  gamePoolRoomInviteUrl,
  releaseGamePoolMembership,
  useGamePoolRoomBackNavigation,
} from "../pool/pool-session.client";
import { MultiplayerLobbyPanel } from "../shared/PixelWorld";

const DIFFICULTY_LABELS = ["calm", "easy", "medium", "hard", "brutal"] as const;

export function CentreRoomApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<CentrePlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    clearExpiredGameLocalStorage();
    setCredentials(
      readExpiringLocalValue<CentrePlayerCredentials>(centreBrowserKeys.playerSession(roomId)),
    );
    captureCentreInvite(roomId);
    setLoaded(true);
  }, [roomId]);
  if (!loaded) return <div className="things-game things-game--night centre" aria-busy="true" />;
  if (!credentials) return <JoinCentreRoom roomId={roomId} onJoined={setCredentials} />;
  return (
    <CentreRoom
      roomId={roomId}
      credentials={credentials}
      onLeft={() => {
        localStorage.removeItem(centreBrowserKeys.playerSession(roomId));
        void releaseGamePoolMembership("centre", roomId).then((entrance) => {
          if (entrance) window.location.assign(entrance);
          else void navigate({ to: "/things/centre" });
        });
      }}
    />
  );
}

export function CentreRoom({
  roomId,
  credentials,
  onLeft,
}: {
  roomId: string;
  credentials: CentrePlayerCredentials;
  onLeft: () => void;
}) {
  const live = useCentreRoom({
    roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = live.snapshot;
  useGamePoolRoomBackNavigation({
    enabled: Boolean(snapshot?.managed),
    game: "centre",
    roomId,
  });
  const haptics = useWebHaptics();
  const sound = useGameSound(gameBrowserKey("centre", 1, "sound"), ["all", "off"]);
  const [route, setRoute] = useState<CentreRoute>({ segments: [], wallHits: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [finishRemaining, setFinishRemaining] = useState<number | null>(null);
  const [replayPlayers, setReplayPlayers] = useState<CentreReplayPlayer[] | null>(null);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [nudgedIds, setNudgedIds] = useState<string[] | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [pending, setPending] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const previousCount = useRef<number | null>(null);
  const previousPhase = useRef(snapshot?.phase);
  const presenceSequence = useRef(0);
  const lastPresenceAt = useRef(0);
  const retiredCourseHash = useRef<string | null>(null);
  const nudgedRef = useRef<string[] | null>(null);
  nudgedRef.current = nudgedIds;
  const routeRef = useRef(route);
  routeRef.current = route;
  const previousStartRequest = useRef<string | null>(null);
  const replayAttempts = useRef(0);
  const course = snapshot?.course;
  const me = snapshot?.players.find(({ id }) => id === credentials.playerId);
  const snapshotPhase = snapshot?.phase;
  const roomExpiresAt = snapshot?.expiresAt;
  const courseSeed = course?.seed;
  const courseDifficulty = course?.difficulty;
  const coursePlayerCount = course?.playerCount;
  const courseHash = course?.hash;
  const courseStartsAt = course?.startsAt;
  const { clockOffset, notify, refresh, setMessage, setSnapshot } = live;
  const maze = useMemo(
    () =>
      courseSeed !== undefined && courseDifficulty !== undefined && coursePlayerCount !== undefined
        ? generateCentreMaze({
            seed: courseSeed,
            difficulty: courseDifficulty,
            playerCount: coursePlayerCount,
          })
        : null,
    [courseDifficulty, coursePlayerCount, courseSeed],
  );
  useWakeLock(Boolean(snapshot && snapshot.phase !== "lobby" && snapshot.phase !== "finished"));

  useEffect(() => {
    if (!roomExpiresAt || roomExpiresAt <= credentials.expiresAt) return;
    writeExpiringLocalValue(
      centreBrowserKeys.playerSession(roomId),
      { ...credentials, expiresAt: roomExpiresAt },
      roomExpiresAt,
    );
  }, [credentials, roomExpiresAt, roomId]);

  const send = useCallback(
    async (action: MultiplayerActionInput<CentreAction>, quiet = false) => {
      try {
        const result = await applyCentreActionFn({
          data: {
            roomId,
            playerId: credentials.playerId,
            playerToken: credentials.playerToken,
            action: { ...action, actionId: crypto.randomUUID() },
          },
        });
        if (result.snapshot) setSnapshot(result.snapshot);
        if (!result.ok || !result.accepted) {
          if (!quiet) setMessage(result.error);
          if (result.ok && result.errorCode === "players_not_ready" && result.snapshot) {
            const removable = result.snapshot.players.filter(
              ({ id, ready }) => !ready && id !== credentials.playerId,
            );
            if (result.snapshot.ready && removable.length > 0) {
              const ids = removable.map(({ id }) => id);
              if (nudgedRef.current) setRemovePlayerIds(ids);
              else {
                setNudgedIds(ids);
                setMessage(
                  `Buzzed ${removable.map(({ name }) => name).join(" and ")} — start again to go without them.`,
                );
              }
            }
          }
        } else {
          setRemovePlayerIds(null);
          setNudgedIds(null);
        }
        notify();
        return result;
      } catch {
        if (!quiet) setMessage("That did not reach the room. Try once more.");
        return null;
      }
    },
    [credentials.playerId, credentials.playerToken, notify, roomId, setMessage, setSnapshot],
  );

  const leaveRoom = useCallback(async () => {
    const result = await send({ type: "player.leave" }, true);
    if (result?.ok && result.accepted) {
      onLeft();
      return true;
    }
    if (result && !result.ok && result.errorCode === "room_unavailable") {
      onLeft();
      return true;
    }
    return false;
  }, [onLeft, send]);

  useEffect(() => {
    if (
      snapshotPhase !== "finished" ||
      !courseHash ||
      me?.elapsedMs !== null ||
      route.segments.length === 0 ||
      retiredCourseHash.current === courseHash
    )
      return;
    retiredCourseHash.current = courseHash;
    void send({ type: "race.retire", courseHash, route }, true);
  }, [courseHash, me?.elapsedMs, route, send, snapshotPhase]);

  const everyoneReady = snapshot?.players.every(({ ready }) => ready) ?? true;
  useEffect(() => {
    if (snapshotPhase !== "lobby" || everyoneReady) setNudgedIds(null);
  }, [everyoneReady, snapshotPhase]);

  const startRequestId = snapshot?.startRequestId ?? null;
  useEffect(() => {
    if (!startRequestId || startRequestId === previousStartRequest.current) return;
    previousStartRequest.current = startRequestId;
    setMessage("The host wants to start — tap ready when you’re back.");
    playCentreSound("count", sound.effects);
    void haptics.trigger("heavy");
  }, [haptics, setMessage, sound.effects, startRequestId]);

  useEffect(() => {
    if (
      (snapshotPhase !== "racing" && snapshotPhase !== "finishing") ||
      !courseHash ||
      me?.elapsedMs !== null
    )
      return;
    const timer = window.setInterval(() => {
      const current = routeRef.current;
      if (current.segments.length === 0) return;
      void send({ type: "race.progress", courseHash, route: current }, true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [courseHash, me?.elapsedMs, send, snapshotPhase]);

  useEffect(() => {
    if (!courseStartsAt || snapshotPhase !== "countdown") return;
    const startsAt = courseStartsAt - clockOffset;
    const timer = window.setInterval(() => {
      const remaining = startsAt - Date.now();
      const count = Math.min(3, Math.max(1, Math.ceil(remaining / 1_000)));
      if (remaining > 0 && previousCount.current !== count) {
        previousCount.current = count;
        playCentreSound("count", sound.effects);
        void haptics.trigger(count === 1 ? "medium" : "selection");
      }
      if (remaining <= 0) {
        window.clearInterval(timer);
        playCentreSound("go", sound.effects);
        void haptics.trigger("heavy");
        void refresh();
      }
    }, 25);
    return () => window.clearInterval(timer);
  }, [haptics, clockOffset, courseStartsAt, refresh, snapshotPhase, sound.effects]);

  useEffect(() => {
    const phase = snapshotPhase;
    if (previousPhase.current !== phase) {
      if (phase === "arming") {
        setRoute({ segments: [], wallHits: 0 });
        setElapsed(0);
        setReplayPlayers(null);
      }
      if (phase === "finished") {
        void haptics.trigger("success");
        playCentreSound("winner", sound.effects);
      }
    }
    previousPhase.current = phase;
  }, [haptics, snapshotPhase, sound.effects]);

  const playerCount = snapshot?.players.length ?? 0;
  useEffect(() => {
    if (snapshotPhase !== "finished") {
      replayAttempts.current = 0;
      return;
    }
    // Keep refetching briefly so late DNF routes (race.retire from other
    // devices) still make it into the replay.
    if (replayPlayers && (replayPlayers.length >= playerCount || replayAttempts.current >= 5))
      return;
    const timer = window.setTimeout(
      () => {
        replayAttempts.current += 1;
        void readCentreReplayFn({
          data: { roomId, playerId: credentials.playerId, playerToken: credentials.playerToken },
        })
          .then((result) => {
            if (result.ok) setReplayPlayers(result.players);
            else if (!replayPlayers) setMessage(result.error);
          })
          .catch(() => {
            if (!replayPlayers) setMessage("The route replay could not be loaded.");
          });
      },
      replayPlayers ? 2_000 : 750,
    );
    return () => window.clearTimeout(timer);
  }, [
    credentials.playerId,
    credentials.playerToken,
    playerCount,
    replayPlayers,
    roomId,
    setMessage,
    snapshotPhase,
  ]);

  useEffect(() => {
    if (!courseStartsAt || (snapshotPhase !== "racing" && snapshotPhase !== "finishing")) return;
    const startsAt = courseStartsAt - clockOffset;
    let frame = 0;
    const tick = () => {
      setElapsed(Math.max(0, Date.now() - startsAt));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockOffset, courseStartsAt, snapshotPhase]);

  useEffect(() => {
    const endsAt = course?.endsAt;
    if (snapshotPhase !== "finishing" || !endsAt) {
      setFinishRemaining(null);
      return;
    }
    const update = () => setFinishRemaining(Math.max(0, endsAt - (Date.now() + clockOffset)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [clockOffset, course?.endsAt, snapshotPhase]);

  if (live.ended || !snapshot || snapshot.phase === "closed")
    return (
      <div className="things-game things-game--night centre">
        <main id="main" className="centre-join">
          <h1 className="centre-title">The room has closed.</h1>
          <p className="centre-note">{live.message ?? "This race is no longer available."}</p>
          <Link to="/things/centre" className="centre-button centre-button--go">
            back to centre
          </Link>
        </main>
      </div>
    );

  if (snapshot.phase === "lobby") {
    const token = sessionStorage.getItem(centreBrowserKeys.invite(roomId));
    const invite = snapshot.managed
      ? (gamePoolRoomInviteUrl("centre", roomId) ?? "")
      : buildCentrePlayerInviteUrl(window.location.origin, roomId, token ?? undefined);
    return (
      <CentreLobby
        snapshot={snapshot}
        playerId={credentials.playerId}
        nudged={nudgedIds !== null}
        invite={invite}
        connection={live.connectionState}
        message={shareMessage ?? live.message}
        onShareMessage={setShareMessage}
        onReady={(ready) => void send({ type: "readiness.set", ready })}
        onDifficulty={(difficulty) => void send({ type: "game.configure", difficulty })}
        onDelayedRivals={(delayedRivals) => void send({ type: "game.configure", delayedRivals })}
        onPassLead={(playerId) => void send({ type: "host.pass", playerId })}
        onRename={() => {
          const current =
            snapshot.players.find(({ id }) => id === credentials.playerId)?.name ?? "";
          const name = window.prompt("Name in this room", current)?.trim();
          if (name && name !== current) void send({ type: "player.rename", name });
        }}
        onStart={() => {
          primeCentreAudio();
          void send({ type: "game.start" });
        }}
        onLeave={leaveRoom}
      />
    );
  }

  if (snapshot.phase === "finished" && maze)
    return (
      <div className="things-game things-game--night centre">
        <header className="centre-header">
          <Link to="/things/centre">← centre</Link>
          <span>{roomId}</span>
          <CentreLeaveButton onLeave={leaveRoom} tone="dark" />
        </header>
        <main id="main" className="centre-finished">
          <p className="centre-eyebrow">race complete</p>
          <h1 className="centre-title">
            {snapshot.players.toSorted((left, right) => (left.place ?? 99) - (right.place ?? 99))[0]
              ?.name ?? "No one"}{" "}
            found the centre.
          </h1>
          {replayPlayers ? (
            <CentreReplay maze={maze} players={replayPlayers} />
          ) : (
            <p className="centre-note">building the route replay…</p>
          )}
          {snapshot.canControl ? (
            <div className="centre-actions">
              <button
                type="button"
                disabled={pending}
                className="centre-button centre-button--go"
                onClick={() => {
                  setPending(true);
                  void send({ type: "game.replay" }).finally(() => setPending(false));
                }}
              >
                new maze
              </button>
              <button
                type="button"
                disabled={pending}
                className="centre-button"
                onClick={() => {
                  setPending(true);
                  void send({ type: "game.lobby" }).finally(() => setPending(false));
                }}
              >
                back to lobby
              </button>
            </div>
          ) : (
            <p className="centre-note">waiting for the host</p>
          )}
        </main>
      </div>
    );

  if (!maze || me?.entranceIndex === null || me?.entranceIndex === undefined)
    return <div className="things-game things-game--night centre" aria-busy="true" />;

  const localStartsAt = course?.startsAt ? course.startsAt - live.clockOffset : null;
  const ownFinished = me.elapsedMs !== null;
  const rivalPoints = snapshot.delayedRivals
    ? Object.entries(live.presence).flatMap(([playerId, point]) => {
        const player = snapshot.players.find(({ id }) => id === playerId);
        return player ? [{ id: playerId, x: point.x, y: point.y, colour: player.colour }] : [];
      })
    : [];
  return (
    <>
      <div className="things-game things-game--night centre">
        <header className="centre-header">
          <Link to="/things/centre">← centre</Link>
          <span>
            {roomId} · {live.connectionState}
          </span>
          <CentreLeaveButton onLeave={leaveRoom} tone="dark" />
        </header>
        <main id="main" className="centre-race">
          <div className="centre-race-copy">
            <p className="centre-eyebrow">
              {ownFinished
                ? "your race is done"
                : `${snapshot.players.filter(({ armed, withdrawn }) => armed && !withdrawn).length} of ${snapshot.players.filter(({ withdrawn }) => !withdrawn).length} on the line`}
            </p>
            <h1 className="centre-race-title">
              {snapshot.phase === "arming"
                ? "Tap your entrance."
                : snapshot.phase === "countdown"
                  ? "Get set."
                  : ownFinished
                    ? "Finished."
                    : `${(elapsed / 1_000).toFixed(1)}s`}
            </h1>
            {ownFinished ? (
              <div className="centre-own-finish" role="status">
                <strong>{(me.elapsedMs! / 1_000).toFixed(2)}s</strong>
                <span>your time · watch the others</span>
              </div>
            ) : null}
            {snapshot.phase === "finishing" && finishRemaining !== null ? (
              <p className="centre-round-timer" role="timer">
                round ends in {(finishRemaining / 1_000).toFixed(1)}s
              </p>
            ) : null}
          </div>
          <ul className="centre-live-players" aria-label="Race progress">
            {snapshot.players.map((player) => (
              <li key={player.id} className={`centre-colour-${player.colour}`}>
                <span aria-hidden="true" />
                <strong>{player.name}</strong>
                <small>
                  {player.elapsedMs !== null
                    ? `${player.id === credentials.playerId ? "done · " : ""}${(player.elapsedMs / 1_000).toFixed(2)}s`
                    : player.withdrawn
                      ? "left the race"
                      : player.armed
                        ? "ready"
                        : snapshot.phase === "arming"
                          ? "tapping in"
                          : "racing"}
                </small>
              </li>
            ))}
          </ul>
          <MazeBoard
            maze={maze}
            entranceIndex={me.entranceIndex}
            phase={ownFinished ? "finished" : snapshot.phase}
            startsAt={localStartsAt}
            route={route}
            playerColour={me.colour}
            rivalPoints={rivalPoints}
            resetNonce={resetNonce}
            onRouteChange={(next) => {
              setRoute(next);
              const point = next.segments.at(-1)?.at(-1);
              const now = Date.now();
              if (
                snapshot.delayedRivals &&
                point &&
                now - lastPresenceAt.current >= 165 &&
                (snapshot.phase === "racing" || snapshot.phase === "finishing")
              ) {
                lastPresenceAt.current = now;
                presenceSequence.current += 1;
                live.sendPresence({
                  type: "presence",
                  x: point.x,
                  y: point.y,
                  t: point.t,
                  sequence: presenceSequence.current,
                });
              }
            }}
            onArmChange={(armed) => {
              primeCentreAudio();
              void send({ type: "arming.set", armed }, true);
            }}
            onCollision={() => {
              void haptics.trigger("nudge");
              playCentreSound("wall", sound.effects);
            }}
            onFinish={(finishedRoute) => {
              const claimedElapsedMs = finishedRoute.segments.at(-1)?.at(-1)?.t ?? elapsed;
              void send({
                type: "race.finish",
                courseHash: course!.hash,
                route: finishedRoute,
                claimedElapsedMs,
              }).then((result) => {
                if (result?.ok && result.accepted) {
                  void haptics.trigger("success");
                  playCentreSound("finish", sound.effects);
                }
              });
            }}
          />
          <div className="centre-race-controls">
            <button
              type="button"
              disabled={snapshot.phase !== "racing" || ownFinished}
              onClick={() => {
                const point = { ...centreEntrancePoint(maze, me.entranceIndex!), t: elapsed };
                setResetNonce((nonce) => nonce + 1);
                setRoute((current) => ({ ...current, segments: [...current.segments, [point]] }));
              }}
            >
              restart route
            </button>
            <button type="button" aria-pressed={sound.effects} onClick={() => sound.cycle()}>
              {sound.effects ? "sound on" : "sound off"}
            </button>
          </div>
          <p role="status" className="centre-message">
            {live.message}
          </p>
        </main>
      </div>
      {removePlayerIds ? (
        <GameActionDialog
          tone="dark"
          eyebrow="players not ready"
          title="Start without them?"
          description={`${snapshot.players
            .filter(({ id }) => removePlayerIds.includes(id))
            .map(({ name }) => name)
            .join(" and ")} will leave this race.`}
          cancelLabel="keep waiting"
          confirmLabel="remove & start"
          pending={pending}
          pendingLabel="starting…"
          onCancel={() => setRemovePlayerIds(null)}
          onConfirm={() => {
            setPending(true);
            void send({ type: "game.start", removePlayerIds }).finally(() => setPending(false));
          }}
        />
      ) : null}
    </>
  );
}

function CentreLobby({
  snapshot,
  playerId,
  nudged,
  invite,
  connection,
  message,
  onShareMessage,
  onReady,
  onDifficulty,
  onDelayedRivals,
  onPassLead,
  onRename,
  onStart,
  onLeave,
}: {
  snapshot: NonNullable<ReturnType<typeof useCentreRoom>["snapshot"]>;
  playerId: string;
  nudged: boolean;
  invite: string;
  connection: string;
  message: string | null;
  onShareMessage: (message: string | null) => void;
  onReady: (ready: boolean) => void;
  onDifficulty: (difficulty: CentreDifficulty) => void;
  onDelayedRivals: (enabled: boolean) => void;
  onPassLead: (playerId: string) => void;
  onRename: () => void;
  onStart: () => void;
  onLeave: () => Promise<boolean>;
}) {
  const { dataUrl: qr, failed } = useQrCode(invite, 280);
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const me = snapshot.players.find(({ id }) => id === playerId);
  const share = async () => {
    const result = await shareOrCopy(
      { title: "Centre", text: `Join centre room ${snapshot.roomId}.`, url: invite },
      { copyValue: invite },
    );
    onShareMessage(
      result === "copied"
        ? "Invite copied."
        : result === "shared"
          ? "Invite shared."
          : result === "failed"
            ? snapshot.managed
              ? "Copy the game-night invite link instead."
              : "Use the room code below."
            : null,
    );
  };
  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <Link to="/things/centre">← centre</Link>
        <span>
          {snapshot.roomId} · {connection}
        </span>
        <CentreLeaveButton onLeave={onLeave} tone="dark" />
      </header>
      <main id="main" className="centre-lobby">
        <p className="centre-eyebrow">room ready</p>
        <h1 className="centre-title">Everyone gets an entrance.</h1>
        <p className="centre-lede">
          Tap your start when you’re set. Once the countdown begins, the race is locked.
        </p>
        <MultiplayerLobbyPanel
          canPassLead={snapshot.canControl && snapshot.players.length > 1}
          currentPlayerId={playerId}
          game="centre"
          onPassLead={onPassLead}
          onRename={onRename}
          roomId={snapshot.roomId}
          tone="night"
          players={snapshot.players.map((player) => ({
            id: player.id,
            name: player.name,
            ready: player.ready,
            lead: player.id === snapshot.hostPlayerId,
            left: player.withdrawn,
          }))}
        />
        {invite ? (
          <>
            {qr ? (
              <AppImage
                src={qr}
                alt="QR code to join this centre room"
                width={280}
                height={280}
                className="centre-qr"
              />
            ) : failed ? (
              <p className="centre-note">
                {snapshot.managed
                  ? "QR unavailable. Copy the game-night invite link."
                  : "QR unavailable. Share the link or room code."}
              </p>
            ) : null}
            <p className="centre-eyebrow">{snapshot.managed ? "game-night room" : "room code"}</p>
            <p className="centre-code">{snapshot.roomId}</p>
            <button type="button" className="centre-button" onClick={() => void share()}>
              {nativeShare ? "share invite" : "copy invite link"}
            </button>
          </>
        ) : null}
        <p aria-live="polite" className="centre-message">
          {message}
        </p>
        {snapshot.canControl && !snapshot.managed ? (
          <>
            <label className="centre-difficulty">
              <span>difficulty</span>
              <strong>{DIFFICULTY_LABELS[snapshot.difficulty - 1]}</strong>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={snapshot.difficulty}
                onChange={(event) => onDifficulty(Number(event.target.value) as CentreDifficulty)}
              />
            </label>
            <label className="centre-check">
              <input
                type="checkbox"
                checked={snapshot.delayedRivals}
                onChange={(event) => onDelayedRivals(event.target.checked)}
              />
              <span>show delayed rival dots</span>
            </label>
          </>
        ) : null}
        <button
          type="button"
          aria-pressed={me?.ready ?? true}
          className={`centre-button${me?.ready ? "" : " centre-button--go"}`}
          onClick={() => onReady(!(me?.ready ?? true))}
        >
          {me?.ready
            ? "ready · tap to wait"
            : snapshot.startRequestId
              ? "the host is waiting — tap when ready"
              : "not ready · tap when ready"}
        </button>
        {snapshot.canControl ? (
          <button type="button" className="centre-button centre-button--go" onClick={onStart}>
            {nudged
              ? `start without ${snapshot.players
                  .filter(({ ready, id }) => !ready && id !== playerId)
                  .map(({ name }) => name)
                  .join(" and ")}`
              : `start · ${snapshot.players.length} racing`}
          </button>
        ) : (
          <p className="centre-note">waiting for the host</p>
        )}
      </main>
    </div>
  );
}

function CentreLeaveButton({
  onLeave,
  tone,
}: {
  onLeave: () => Promise<boolean>;
  tone: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        type="button"
        className="centre-button centre-header-leave"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        leave room
      </button>
      {open ? (
        <GameActionDialog
          tone={tone}
          eyebrow="leave room"
          title="Leave this room?"
          description="You will give up your seat. If you are the host, the oldest connected player will take over."
          cancelLabel="stay"
          confirmLabel="leave room"
          pending={pending}
          pendingLabel="leaving…"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setPending(true);
            void onLeave().then((left) => {
              setPending(false);
              if (left) setOpen(false);
            });
          }}
        />
      ) : null}
    </>
  );
}
