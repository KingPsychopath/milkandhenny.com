import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { GameActionDialog } from "../shared/GameActionDialog";
import { CountryRoundBoard } from "./CountryRoundBoard";
import { applyDrawCountryActionFn } from "./draw-country-room.functions";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { FinalRanking, RoomHeader, RoomLobby, RoomReveal } from "./DrawCountryRoomViews";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_RINGS,
  MAX_POINTS_PER_RING,
} from "./drawing-constraints";
import { captureDrawCountryInvite } from "./invite.client";
import { JoinDrawCountryRoom } from "./JoinDrawCountryRoom";
import type { CountryDrawing, DrawCountryAction, DrawCountryPlayerCredentials } from "./types";
import type { CountryOutline } from "./types";
import { loadCountryOutline } from "./rotation.client";
import { useDrawCountryRoom } from "./useDrawCountryRoom";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useSafeGameNavigation } from "../shared/useSafeGameNavigation";
import { useReliableMultiplayerAction } from "../shared/useReliableMultiplayerAction";
import type { MultiplayerActionInput } from "../shared/multiplayer";
import { useActionDialog } from "@/hooks/useActionDialog";
import {
  clearUnavailableGamePoolMembership,
  leaveGamePoolRoom,
  useGamePoolRoomBackNavigation,
} from "../pool/pool-session.client";
import { RoomUnavailableState } from "../shared/RoomUnavailableState";
import { useRoomUnavailableRecovery } from "../shared/useRoomUnavailableRecovery";

export function DrawCountryRoomApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<DrawCountryPlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    clearExpiredGameLocalStorage();
    setCredentials(
      readExpiringLocalValue<DrawCountryPlayerCredentials>(
        drawCountryBrowserKeys.playerSession(roomId),
      ),
    );
    captureDrawCountryInvite(roomId);
    setLoaded(true);
  }, [roomId]);

  if (!loaded) return <div className="things-game things-game--cream" aria-busy="true" />;
  if (!credentials) return <JoinDrawCountryRoom roomId={roomId} onJoined={setCredentials} />;
  return (
    <DrawCountryRoom
      roomId={roomId}
      credentials={credentials}
      onUnavailable={() => {
        localStorage.removeItem(drawCountryBrowserKeys.playerSession(roomId));
        void clearUnavailableGamePoolMembership("draw-country", roomId);
      }}
      onLeft={() => {
        localStorage.removeItem(drawCountryBrowserKeys.playerSession(roomId));
        void leaveGamePoolRoom("draw-country", roomId).then((entrance) => {
          if (entrance) window.location.assign(entrance);
          else void navigate({ to: "/things/draw-country" });
        });
      }}
    />
  );
}

function drawingKey(roomId: string, roundId: string) {
  return `things:draw-country:v1:room:${roomId}:round:${roundId}:drawing`;
}

function readDrawing(roomId: string, roundId: string): CountryDrawing {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(drawingKey(roomId, roundId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    const result: CountryDrawing = [];
    let total = 0;
    for (const candidate of value.slice(0, MAX_DRAWING_RINGS)) {
      if (!Array.isArray(candidate) || total >= MAX_DRAWING_POINTS) continue;
      const ring: CountryDrawing[number] = [];
      for (const point of candidate.slice(0, MAX_POINTS_PER_RING)) {
        if (total >= MAX_DRAWING_POINTS) break;
        if (!point || typeof point !== "object") continue;
        const x = Reflect.get(point, "x");
        const y = Reflect.get(point, "y");
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > DRAWING_WIDTH ||
          y < 0 ||
          y > DRAWING_HEIGHT
        )
          continue;
        ring.push({ x, y });
        total += 1;
      }
      if (ring.length) result.push(ring);
    }
    return result;
  } catch {
    return [];
  }
}

function DrawCountryRoom({
  roomId,
  credentials,
  onLeft,
  onUnavailable,
}: {
  roomId: string;
  credentials: DrawCountryPlayerCredentials;
  onLeft: () => void;
  onUnavailable?: () => void;
}) {
  const live = useDrawCountryRoom({
    roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = live.snapshot;
  const { roomUnavailable, markUnavailable } = useRoomUnavailableRecovery({
    roomKey: roomId,
    unavailable: live.ended || snapshot?.phase === "closed",
    onUnavailable,
  });
  useSafeGameNavigation(snapshot?.phase === "lobby" || snapshot?.phase === "finished");
  useGamePoolRoomBackNavigation({
    enabled: Boolean(snapshot?.managed),
    game: "draw-country",
    roomId,
  });
  const haptics = useWebHaptics();
  const [drawing, setDrawingState] = useState<CountryDrawing>([]);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRound = useRef<string | null>(null);
  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  const previousPhase = useRef(snapshot?.phase);
  const previousStartRequest = useRef<string | null>(null);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const { prompt, dialog } = useActionDialog();
  const [nudgedIds, setNudgedIds] = useState<string[] | null>(null);
  const nudgedRef = useRef<string[] | null>(null);
  nudgedRef.current = nudgedIds;
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [country, setCountry] = useState<CountryOutline | null>(null);
  const setLiveMessage = live.setMessage;
  useWakeLock(snapshot?.phase === "drawing" || snapshot?.phase === "reveal");

  // A rematch pushes the room's expiry out; without this the stored credentials would lapse
  // mid-session and drop the player back onto the join screen.
  const storedExpiry = credentials.expiresAt;
  const roomExpiry = snapshot?.expiresAt;
  useEffect(() => {
    if (!roomExpiry || roomExpiry <= storedExpiry) return;
    writeExpiringLocalValue(
      drawCountryBrowserKeys.playerSession(roomId),
      { ...credentials, expiresAt: roomExpiry },
      roomExpiry,
    );
  }, [credentials, roomExpiry, roomId, storedExpiry]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [snapshot?.phase, snapshot?.round?.id]);

  const roundId = snapshot?.round?.id;
  const countryId = snapshot?.round?.countryId;
  useEffect(() => {
    let active = true;
    setCountry(null);
    if (countryId)
      void loadCountryOutline(countryId).then((outline) => {
        if (active) setCountry(outline);
      });
    return () => {
      active = false;
    };
  }, [countryId]);

  useEffect(() => {
    if (!roundId) return;
    setDrawingState(readDrawing(roomId, roundId));
    setSubmitting(false);
    submittedRound.current = null;
  }, [roomId, roundId]);

  useEffect(() => {
    if (!snapshot?.round || snapshot.phase !== "drawing") return;
    const tick = () =>
      setSeconds(
        Math.max(0, Math.ceil((snapshot.round!.endsAt - (Date.now() + live.clockOffset)) / 1_000)),
      );
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [live.clockOffset, snapshot?.phase, snapshot?.round]);

  useEffect(() => {
    if (previousPhase.current !== "reveal" && snapshot?.phase === "reveal")
      void haptics.trigger("success");
    previousPhase.current = snapshot?.phase;
  }, [haptics, snapshot?.phase]);

  useEffect(() => {
    const requestId = snapshot?.player?.startRequestId ?? null;
    if (!requestId || requestId === previousStartRequest.current) return;
    previousStartRequest.current = requestId;
    setLiveMessage("The host wants to start — tap “I’m ready” if you stepped away.");
    void haptics.trigger("heavy");
  }, [haptics, setLiveMessage, snapshot?.player?.startRequestId]);

  const everyoneReady = snapshot?.players.every(({ ready }) => ready) ?? true;
  const snapshotPhase = snapshot?.phase;
  useEffect(() => {
    if (snapshotPhase !== "lobby" || everyoneReady) setNudgedIds(null);
  }, [everyoneReady, snapshotPhase]);

  const setDrawing = (next: CountryDrawing) => {
    setDrawingState(next);
    if (roundId) sessionStorage.setItem(drawingKey(roomId, roundId), JSON.stringify(next));
  };

  const dispatchAction = useReliableMultiplayerAction(
    (action: MultiplayerActionInput<DrawCountryAction>, actionId) =>
      applyDrawCountryActionFn({
        data: {
          roomId,
          playerId: credentials.playerId,
          playerToken: credentials.playerToken,
          action: { ...action, actionId },
        },
      }),
    `${roomId}:${credentials.playerId}:${snapshot?.sequence ?? "loading"}`,
  );

  const submit = async () => {
    const round = snapshot?.round;
    if (!round || submitting || submittedRound.current === round.id) return;
    submittedRound.current = round.id;
    setSubmitting(true);
    try {
      const result = await dispatchAction({
        type: "drawing.submit",
        roundId: round.id,
        drawing,
      });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.ok && result.errorCode === "room_unavailable") markUnavailable();
      if (!result.ok || !result.accepted) live.setMessage(result.error);
      live.notify();
      void live.refresh();
    } catch {
      submittedRound.current = null;
      setSubmitting(false);
      live.setMessage("Could not lock in yet. Trying again…");
    }
  };

  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    if (
      snapshot?.phase === "drawing" &&
      seconds === 0 &&
      snapshot.round &&
      Date.now() + live.clockOffset >= snapshot.round.endsAt
    )
      void submitRef.current();
  }, [live.clockOffset, seconds, snapshot?.phase, snapshot?.round]);

  const control = async (
    action:
      | { type: "game.start"; removePlayerIds?: string[] }
      | { type: "round.next" }
      | { type: "game.replay" }
      | { type: "game.lobby" }
      | { type: "readiness.set"; ready: boolean }
      | { type: "room.admission.set"; locked: boolean }
      | { type: "player.leave" }
      | { type: "player.rename"; name: string }
      | { type: "host.pass"; playerId: string },
  ) => {
    try {
      const result = await dispatchAction(action);
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.ok && result.errorCode === "room_unavailable" && action.type !== "player.leave")
        markUnavailable();
      if (!result.ok || !result.accepted) {
        live.setMessage(result.error);
        if (result.ok && result.errorCode === "players_not_ready" && result.snapshot) {
          const removable = result.snapshot.players.filter(
            ({ id, ready }) => !ready && id !== credentials.playerId,
          );
          if (result.snapshot.player.ready && removable.length > 0) {
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
        void haptics.trigger("selection");
      }
      live.notify();
      return result;
    } catch {
      live.setMessage("That did not reach the room. Try once more.");
      return null;
    }
  };

  const leaveRoom = async () => {
    const result = await control({ type: "player.leave" });
    if (result?.ok && result.accepted) {
      onLeft();
      return true;
    }
    if (result && !result.ok && result.errorCode === "room_unavailable") {
      onLeft();
      return true;
    }
    return false;
  };

  const confirmStart = async () => {
    if (!removePlayerIds) return;
    setConfirmingStart(true);
    try {
      await control({ type: "game.start", removePlayerIds });
    } finally {
      setConfirmingStart(false);
    }
  };

  const rematch = async (type: "game.replay" | "game.lobby") => {
    setRestarting(true);
    try {
      await control({ type });
    } finally {
      setRestarting(false);
    }
  };

  if (roomUnavailable)
    return (
      <div className="things-game things-game--cream text-black">
        <RoomUnavailableState gameName="draw the country" gamePath="/things/draw-country" />
      </div>
    );

  if (!snapshot) return <div className="things-game things-game--cream" aria-busy="true" />;

  if (snapshot.phase === "lobby")
    return (
      <>
        <RoomLobby
          snapshot={snapshot}
          playerId={credentials.playerId}
          connection={live.connectionState}
          message={live.message}
          onReadyChange={(ready) => void control({ type: "readiness.set", ready })}
          onStart={() => void control({ type: "game.start" })}
          onPassLead={(playerId) => void control({ type: "host.pass", playerId })}
          onAdmissionChange={(locked) => void control({ type: "room.admission.set", locked })}
          onRename={async () => {
            const current =
              snapshot.players.find(({ id }) => id === credentials.playerId)?.name ?? "";
            const name = (
              await prompt({
                tone: "light",
                eyebrow: "player name",
                title: "What should we call you?",
                description: "This name is shown to everyone in the room.",
                label: "Name",
                defaultValue: current,
                confirmLabel: "save name",
                required: true,
              })
            )?.trim();
            if (name && name !== current) void control({ type: "player.rename", name });
          }}
          onLeave={leaveRoom}
          startLabel={
            nudgedIds
              ? `start without ${snapshot.players
                  .filter(({ id, ready }) => !ready && id !== credentials.playerId)
                  .map(({ name }) => name)
                  .join(" and ")}`
              : null
          }
        />
        {removePlayerIds ? (
          <GameActionDialog
            tone="light"
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
            onConfirm={() => void confirmStart()}
          />
        ) : null}
        {dialog}
      </>
    );

  if (snapshot.phase === "drawing" && snapshot.round) {
    const me = snapshot.players.find(({ id }) => id === credentials.playerId);
    return (
      <div className="things-game things-game--cream text-black">
        <RoomHeader roomId={roomId} connection={live.connectionState} onLeave={leaveRoom} />
        <CountryRoundBoard
          countryName={snapshot.round.countryName}
          roundLabel={`${snapshot.round.number}/${snapshot.round.total}`}
          drawing={drawing}
          seconds={seconds}
          submitting={submitting}
          submitted={me?.submitted}
          submitLabel="lock in"
          onChange={setDrawing}
          onDone={() => void submit()}
        />
        {me?.submitted ? (
          <p aria-live="polite" className="pb-5 text-center font-mono text-xs text-black/45">
            locked in · waiting for everyone
          </p>
        ) : null}
      </div>
    );
  }

  if (snapshot.phase === "reveal" && snapshot.round)
    return (
      <RoomReveal
        snapshot={snapshot}
        playerId={credentials.playerId}
        drawing={drawing}
        country={country}
        connection={live.connectionState}
        onNext={() => void control({ type: "round.next" })}
        onLeave={leaveRoom}
      />
    );

  return (
    <FinalRanking
      snapshot={snapshot}
      playerId={credentials.playerId}
      message={live.message}
      pending={restarting}
      onPlayAgain={() => void rematch("game.replay")}
      onBackToLobby={() => void rematch("game.lobby")}
      onLeave={leaveRoom}
    />
  );
}
