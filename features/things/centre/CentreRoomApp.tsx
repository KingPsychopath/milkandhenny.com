import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { useQrCode } from "@/hooks/useQrCode";
import { useWakeLock } from "@/hooks/useWakeLock";
import { shareOrCopy } from "@/lib/client/share";
import { GameActionDialog } from "../shared/GameActionDialog";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { gameBrowserKey } from "../shared/multiplayer-keys";
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

const DIFFICULTY_LABELS = ["calm", "easy", "medium", "hard", "brutal"] as const;

export function CentreRoomApp({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<CentrePlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setCredentials(
      readExpiringLocalValue<CentrePlayerCredentials>(centreBrowserKeys.playerSession(roomId)),
    );
    captureCentreInvite(roomId);
    setLoaded(true);
  }, [roomId]);
  if (!loaded) return <div className="things-game things-game--night centre" aria-busy="true" />;
  if (!credentials) return <JoinCentreRoom roomId={roomId} onJoined={setCredentials} />;
  return <CentreRoom roomId={roomId} credentials={credentials} />;
}

export function CentreRoom({
  roomId,
  credentials,
}: {
  roomId: string;
  credentials: CentrePlayerCredentials;
}) {
  const live = useCentreRoom({
    roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = live.snapshot;
  const haptics = useWebHaptics();
  const sound = useGameSound(gameBrowserKey("centre", 1, "sound"), ["all", "off"]);
  const [route, setRoute] = useState<CentreRoute>({ segments: [], wallHits: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [replayPlayers, setReplayPlayers] = useState<CentreReplayPlayer[] | null>(null);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const previousCount = useRef<number | null>(null);
  const previousPhase = useRef(snapshot?.phase);
  const presenceSequence = useRef(0);
  const lastPresenceAt = useRef(0);
  const retiredCourseHash = useRef<string | null>(null);
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
    async (action: CentreAction, quiet = false) => {
      try {
        const result = await applyCentreActionFn({
          data: {
            roomId,
            playerId: credentials.playerId,
            playerToken: credentials.playerToken,
            action,
          },
        });
        if (result.snapshot) setSnapshot(result.snapshot);
        if (!result.ok || !result.accepted) {
          if (!quiet) setMessage(result.error);
          if (result.ok && result.errorCode === "players_not_ready" && result.snapshot) {
            const removable = result.snapshot.players.filter(
              ({ id, ready }) => !ready && id !== credentials.playerId,
            );
            if (result.snapshot.ready && removable.length > 0)
              setRemovePlayerIds(removable.map(({ id }) => id));
          }
        } else setRemovePlayerIds(null);
        notify();
        return result;
      } catch {
        if (!quiet) setMessage("That did not reach the room. Try once more.");
        return null;
      }
    },
    [credentials.playerId, credentials.playerToken, notify, roomId, setMessage, setSnapshot],
  );

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

  useEffect(() => {
    if (snapshotPhase !== "finished" || replayPlayers) return;
    const timer = window.setTimeout(() => {
      void readCentreReplayFn({
        data: { roomId, playerId: credentials.playerId, playerToken: credentials.playerToken },
      })
        .then((result) => {
          if (result.ok) setReplayPlayers(result.players);
          else setMessage(result.error);
        })
        .catch(() => setMessage("The route replay could not be loaded."));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    credentials.playerId,
    credentials.playerToken,
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

  if (live.ended || !snapshot)
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
    const invite = buildCentrePlayerInviteUrl(window.location.origin, roomId, token ?? undefined);
    return (
      <CentreLobby
        snapshot={snapshot}
        playerId={credentials.playerId}
        invite={invite}
        connection={live.connectionState}
        message={shareMessage ?? live.message}
        onShareMessage={setShareMessage}
        onReady={(ready) => void send({ type: "readiness.set", ready })}
        onDifficulty={(difficulty) => void send({ type: "game.configure", difficulty })}
        onDelayedRivals={(delayedRivals) => void send({ type: "game.configure", delayedRivals })}
        onStart={() => {
          primeCentreAudio();
          void send({ type: "game.start" });
        }}
      />
    );
  }

  if (snapshot.phase === "finished" && maze)
    return (
      <div className="things-game things-game--night centre">
        <header className="centre-header">
          <Link to="/things/centre">← leave</Link>
          <span>{roomId}</span>
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
          <Link to="/things/centre">← leave</Link>
          <span>
            {roomId} · {live.connectionState}
          </span>
        </header>
        <main id="main" className="centre-race">
          <div className="centre-race-copy">
            <p className="centre-eyebrow">
              {snapshot.players.filter(({ armed }) => armed).length} of {snapshot.players.length} on
              the line
            </p>
            <h1 className="centre-race-title">
              {snapshot.phase === "arming"
                ? "Place your finger."
                : snapshot.phase === "countdown"
                  ? "Get set."
                  : ownFinished
                    ? `${(me.elapsedMs! / 1_000).toFixed(2)}s`
                    : `${(elapsed / 1_000).toFixed(1)}s`}
            </h1>
          </div>
          <MazeBoard
            maze={maze}
            entranceIndex={me.entranceIndex}
            phase={ownFinished ? "finished" : snapshot.phase}
            startsAt={localStartsAt}
            route={route}
            playerColour={me.colour}
            rivalPoints={rivalPoints}
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
          <ul className="centre-live-players" aria-label="Race progress">
            {snapshot.players.map((player) => (
              <li key={player.id} className={`centre-colour-${player.colour}`}>
                <span aria-hidden="true" />
                <strong>{player.name}</strong>
                <small>
                  {player.elapsedMs !== null
                    ? `${(player.elapsedMs / 1_000).toFixed(2)}s`
                    : player.armed
                      ? "on the line"
                      : "placing"}
                </small>
              </li>
            ))}
          </ul>
          <div className="centre-race-controls">
            <button
              type="button"
              disabled={snapshot.phase !== "racing" || ownFinished}
              onClick={() => {
                const point = { ...centreEntrancePoint(maze, me.entranceIndex!), t: elapsed };
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
  invite,
  connection,
  message,
  onShareMessage,
  onReady,
  onDifficulty,
  onDelayedRivals,
  onStart,
}: {
  snapshot: NonNullable<ReturnType<typeof useCentreRoom>["snapshot"]>;
  playerId: string;
  invite: string;
  connection: string;
  message: string | null;
  onShareMessage: (message: string | null) => void;
  onReady: (ready: boolean) => void;
  onDifficulty: (difficulty: CentreDifficulty) => void;
  onDelayedRivals: (enabled: boolean) => void;
  onStart: () => void;
}) {
  const { dataUrl: qr, failed } = useQrCode(invite, 280);
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
            ? "Use the room code below."
            : null,
    );
  };
  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <Link to="/things/centre">← leave</Link>
        <span>
          {snapshot.roomId} · {connection}
        </span>
      </header>
      <main id="main" className="centre-lobby">
        <p className="centre-eyebrow">room ready</p>
        <h1 className="centre-title">Everyone gets an entrance.</h1>
        <p className="centre-lede">
          Hold your start until everyone is on the line. Once the countdown begins, the race is
          locked.
        </p>
        {qr ? (
          <img src={qr} alt="QR code to join this centre room" className="centre-qr" />
        ) : failed ? (
          <p className="centre-note">QR unavailable. Share the link or room code.</p>
        ) : null}
        <p className="centre-code">{snapshot.roomId}</p>
        <button type="button" className="centre-button" onClick={() => void share()}>
          share invite
        </button>
        <p aria-live="polite" className="centre-message">
          {message}
        </p>
        <ul className="centre-roster">
          {snapshot.players.map((player) => (
            <li key={player.id}>
              {player.name}
              {player.id === snapshot.hostPlayerId ? " · host" : ""}
              {player.ready ? "" : " · not ready"}
            </li>
          ))}
        </ul>
        {snapshot.canControl ? (
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
          className="centre-button"
          onClick={() => onReady(!(me?.ready ?? true))}
        >
          {me?.ready ? "ready · tap to wait" : "not ready · tap when ready"}
        </button>
        {snapshot.canControl ? (
          <button type="button" className="centre-button centre-button--go" onClick={onStart}>
            start · {snapshot.players.length} racing
          </button>
        ) : (
          <p className="centre-note">waiting for the host</p>
        )}
      </main>
    </div>
  );
}
