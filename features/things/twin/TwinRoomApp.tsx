import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { GameActionDialog } from "../shared/GameActionDialog";
import { captureTwinInvite } from "./invite.client";
import { JoinTwinRoom } from "./JoinTwinRoom";
import { TwinBoard } from "./TwinBoard";
import { TwinFinished } from "./TwinFinished";
import { twinBrowserKeys } from "./twin-keys";
import { applyTwinActionFn } from "./twin-room.functions";
import { TwinHeader, TwinLobby, TwinSettle, TwinStandings } from "./TwinViews";
import { useGameSound } from "../shared/useGameSound";
import { gameBrowserKey } from "../shared/multiplayer-keys";
import { playTwinSound, primeTwinAudio } from "./twin-sound.client";
import type { TwinHeartbeatTiming } from "./twin-rules";
import { useTwinPalette } from "./useTwinPalette";
import { useTwinRoom } from "./useTwinRoom";
import type { TwinAction, TwinPlayerCredentials } from "./types";
import { releaseGamePoolMembership } from "../pool/pool-session.client";

export function TwinRoomApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<TwinPlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    clearExpiredGameLocalStorage();
    setCredentials(
      readExpiringLocalValue<TwinPlayerCredentials>(twinBrowserKeys.playerSession(roomId)),
    );
    captureTwinInvite(roomId);
    setLoaded(true);
  }, [roomId]);

  if (!loaded) return <div className="things-game things-game--night twin" aria-busy="true" />;
  if (!credentials) return <JoinTwinRoom roomId={roomId} onJoined={setCredentials} />;
  return (
    <TwinRoom
      roomId={roomId}
      credentials={credentials}
      onLeft={() => {
        localStorage.removeItem(twinBrowserKeys.playerSession(roomId));
        void releaseGamePoolMembership("twin", roomId).then((entrance) => {
          if (entrance) window.location.assign(entrance);
          else void navigate({ to: "/things/twin" });
        });
      }}
    />
  );
}

/**
 * The room itself, taking its credentials as a prop.
 *
 * Exported because the dev harness mounts several of these at once, and they cannot each read from
 * localStorage: every panel in a harness shares one browser, one origin, and — for the same room id —
 * one key, so the last write would win and every panel would show the same player.
 */
export function TwinRoom({
  roomId,
  credentials,
  heartbeatTiming,
  onLeft,
}: {
  roomId: string;
  credentials: TwinPlayerCredentials;
  heartbeatTiming?: TwinHeartbeatTiming;
  onLeft?: () => void;
}) {
  const live = useTwinRoom({
    roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = live.snapshot;
  const haptics = useWebHaptics();
  const palette = useTwinPalette();
  // Two states, not three: twin has nothing that reads aloud, so "no voice" would be a dead option.
  const sound = useGameSound(gameBrowserKey("twin", 1, "sound"), ["all", "off"]);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [nudgedIds, setNudgedIds] = useState<string[] | null>(null);
  const nudgedRef = useRef<string[] | null>(null);
  nudgedRef.current = nudgedIds;
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const previousPhase = useRef(snapshot?.phase);
  const previousStartRequest = useRef<string | null>(null);
  const setLiveMessage = live.setMessage;

  // A tablet on a table, untouched between taps, sleeps faster than anywhere else in this codebase —
  // and a dimmed screen ends the heat.
  useWakeLock(
    snapshot?.phase === "dealing" || snapshot?.phase === "heat" || snapshot?.phase === "settle",
  );

  // A rematch pushes the room's expiry out; without this the stored credentials lapse mid-session.
  const storedExpiry = credentials.expiresAt;
  const roomExpiry = snapshot?.expiresAt;
  useEffect(() => {
    if (!roomExpiry || roomExpiry <= storedExpiry) return;
    writeExpiringLocalValue(
      twinBrowserKeys.playerSession(roomId),
      { ...credentials, expiresAt: roomExpiry },
      roomExpiry,
    );
  }, [credentials, roomExpiry, roomId, storedExpiry]);

  useEffect(() => {
    const phase = snapshot?.phase;
    if (previousPhase.current !== phase) {
      if (phase === "settle") {
        void haptics.trigger("selection");
        playTwinSound("settle", sound.effects);
      }
      if (phase === "finished") {
        void haptics.trigger("success");
        playTwinSound("win", sound.effects);
      }
    }
    previousPhase.current = phase;
  }, [haptics, snapshot?.phase, sound.effects]);

  const everyoneReady = snapshot?.players.every(({ ready }) => ready) ?? true;
  const snapshotPhase = snapshot?.phase;
  useEffect(() => {
    if (snapshotPhase !== "lobby" || everyoneReady) setNudgedIds(null);
  }, [everyoneReady, snapshotPhase]);

  useEffect(() => {
    const requestId = snapshot?.player?.startRequestId ?? null;
    if (!requestId || requestId === previousStartRequest.current) return;
    previousStartRequest.current = requestId;
    setLiveMessage("The host wants to start — tap “I’m ready” if you stepped away.");
    void haptics.trigger("heavy");
  }, [haptics, setLiveMessage, snapshot?.player?.startRequestId]);

  const send = async (action: TwinAction, quiet = false) => {
    try {
      const result = await applyTwinActionFn({
        data: {
          roomId,
          playerId: credentials.playerId,
          playerToken: credentials.playerToken,
          action,
        },
      });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.ok || !result.accepted) {
        // A wrong tap and a cooldown are the game talking, not an error worth a banner.
        const expected =
          result.ok &&
          (result.errorCode === "wrong_symbol" ||
            result.errorCode === "cooling_down" ||
            result.errorCode === "already_landed" ||
            result.errorCode === "heat_ended");
        if (!quiet && !expected) live.setMessage(result.error);
        if (result.ok && result.errorCode === "players_not_ready" && result.snapshot) {
          const removable = result.snapshot.players.filter(
            ({ id, ready }) => !ready && id !== credentials.playerId,
          );
          if (result.snapshot.player?.ready && removable.length > 0) {
            const ids = removable.map(({ id }) => id);
            // First attempt buzzes the stragglers; a second attempt offers to go without them.
            if (nudgedRef.current) setRemovePlayerIds(ids);
            else {
              setNudgedIds(ids);
              live.setMessage(
                `Buzzed ${removable.map(({ name }) => name).join(" and ")} — start again to go without them.`,
              );
            }
          }
        }
      } else {
        setRemovePlayerIds(null);
        setNudgedIds(null);
      }
      live.notify();
      return result;
    } catch {
      if (!quiet) live.setMessage("That did not reach the room. Try once more.");
      return null;
    }
  };

  const leaveRoom = async () => {
    const result = await send({ type: "player.leave" }, true);
    if (result?.ok && result.accepted) {
      onLeft?.();
      return true;
    }
    if (result && !result.ok && result.errorCode === "room_unavailable") {
      onLeft?.();
      return true;
    }
    return false;
  };

  if (live.ended || !snapshot || snapshot.phase === "closed")
    return (
      <div className="things-game things-game--night twin">
        <main id="main" className="twin-gone">
          <h1 className="twin-title">The room has gone quiet.</h1>
          <p className="twin-lede">{live.message ?? "This room is no longer available."}</p>
          <Link to="/things/twin" className="twin-button twin-button--go">
            back to the game
          </Link>
        </main>
      </div>
    );

  if (snapshot.phase === "lobby")
    return (
      <>
        <TwinLobby
          snapshot={snapshot}
          playerId={credentials.playerId}
          connection={live.connectionState}
          message={live.message}
          onReadyChange={(ready) => void send({ type: "readiness.set", ready })}
          startLabel={
            nudgedIds
              ? `start without ${snapshot.players
                  .filter(({ id, ready }) => !ready && id !== credentials.playerId)
                  .map(({ name }) => name)
                  .join(" and ")}`
              : null
          }
          onStart={() => {
            // The browser only lets audio start from a gesture, and this is the last one before play.
            primeTwinAudio();
            void send({ type: "game.start" });
          }}
          onLeave={leaveRoom}
          onHandSize={(handSize) => void send({ type: "game.configure", handSize })}
          colour={palette.colour}
          onColour={palette.toggle}
          sound={sound.effects}
          onSound={() => {
            primeTwinAudio();
            sound.cycle();
            playTwinSound("connection", !sound.effects);
          }}
        />
        {removePlayerIds ? (
          <GameActionDialog
            tone="dark"
            eyebrow="players not ready"
            title={
              snapshot.players.some(({ id, ready }) => removePlayerIds.includes(id) && !ready)
                ? "Start without them?"
                : "Everyone is ready now."
            }
            description={(() => {
              const names = snapshot.players
                .filter(({ id, ready }) => removePlayerIds.includes(id) && !ready)
                .map(({ name }) => name);
              return names.length
                ? `${names.join(" and ")} will be removed from this game.`
                : "No one will be removed.";
            })()}
            cancelLabel="keep waiting"
            confirmLabel={
              snapshot.players.some(({ id, ready }) => removePlayerIds.includes(id) && !ready)
                ? "remove & start"
                : "start game"
            }
            pending={confirmingStart}
            pendingLabel="starting…"
            onCancel={() => setRemovePlayerIds(null)}
            onConfirm={() => {
              setConfirmingStart(true);
              void send({ type: "game.start", removePlayerIds }).finally(() =>
                setConfirmingStart(false),
              );
            }}
          />
        ) : null}
      </>
    );

  if (snapshot.phase === "finished")
    return (
      <TwinFinished
        snapshot={snapshot}
        playerId={credentials.playerId}
        playerToken={credentials.playerToken}
        message={live.message}
        pending={restarting}
        onPlayAgain={() => {
          setRestarting(true);
          void send({ type: "game.replay" }).finally(() => setRestarting(false));
        }}
        onBackToLobby={() => {
          setRestarting(true);
          void send({ type: "game.lobby" }).finally(() => setRestarting(false));
        }}
        onLeave={leaveRoom}
      />
    );

  return (
    <div className="things-game things-game--night twin">
      <TwinHeader roomId={roomId} connection={live.connectionState} onLeave={leaveRoom} />
      <TwinBoard
        snapshot={snapshot}
        clockOffset={live.clockOffset}
        sound={sound.effects}
        heartbeatTiming={heartbeatTiming}
        onTap={(symbolId, elapsedMs) =>
          void send(
            { type: "answer.tap", heatId: snapshot.heat?.id ?? "", symbolId, elapsedMs },
            true,
          )
        }
      />
      {snapshot.phase === "settle" ? (
        <>
          <TwinSettle snapshot={snapshot} playerId={credentials.playerId} />
          <TwinStandings snapshot={snapshot} playerId={credentials.playerId} />
          {snapshot.canControl ? (
            <button
              type="button"
              className="twin-button twin-button--quiet twin-button--inline"
              onClick={() => void send({ type: "heat.next" })}
            >
              next heat now
            </button>
          ) : null}
        </>
      ) : null}
      <p aria-live="polite" className="twin-message">
        {live.message}
      </p>
    </div>
  );
}
