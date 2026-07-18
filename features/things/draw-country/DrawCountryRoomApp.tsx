import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { readExpiringLocalValue } from "../shared/game-storage.client";
import { GameActionDialog } from "../shared/GameActionDialog";
import { CountryRoundBoard } from "./CountryRoundBoard";
import { applyDrawCountryActionFn } from "./draw-country-room.functions";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { FinalRanking, RoomHeader, RoomLobby, RoomReveal } from "./DrawCountryRoomViews";
import { captureDrawCountryInvite } from "./invite.client";
import { JoinDrawCountryRoom } from "./JoinDrawCountryRoom";
import type { CountryDrawing, DrawCountryPlayerCredentials } from "./types";
import { useDrawCountryRoom } from "./useDrawCountryRoom";

export function DrawCountryRoomApp({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<DrawCountryPlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
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
  return <DrawCountryRoom roomId={roomId} credentials={credentials} />;
}

function drawingKey(roomId: string, roundId: string) {
  return `things:draw-country:v1:room:${roomId}:round:${roundId}:drawing`;
}

function readDrawing(roomId: string, roundId: string): CountryDrawing {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(drawingKey(roomId, roundId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(Array.isArray)
      .map((ring) =>
        ring
          .filter((point): point is { x: number; y: number } =>
            Boolean(
              point &&
              typeof point === "object" &&
              typeof Reflect.get(point, "x") === "number" &&
              typeof Reflect.get(point, "y") === "number",
            ),
          )
          .map(({ x, y }) => ({ x, y })),
      );
  } catch {
    return [];
  }
}

function DrawCountryRoom({
  roomId,
  credentials,
}: {
  roomId: string;
  credentials: DrawCountryPlayerCredentials;
}) {
  const live = useDrawCountryRoom({
    roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = live.snapshot;
  const haptics = useWebHaptics();
  const [drawing, setDrawingState] = useState<CountryDrawing>([]);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRound = useRef<string | null>(null);
  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  const previousPhase = useRef(snapshot?.phase);
  const previousStartRequest = useRef<string | null>(null);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const setLiveMessage = live.setMessage;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [snapshot?.phase, snapshot?.round?.id]);

  const roundId = snapshot?.round?.id;
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
    setLiveMessage("The host is ready to start — tap Ready when you are.");
    void haptics.trigger("heavy");
  }, [haptics, setLiveMessage, snapshot?.player?.startRequestId]);

  const setDrawing = (next: CountryDrawing) => {
    setDrawingState(next);
    if (roundId) sessionStorage.setItem(drawingKey(roomId, roundId), JSON.stringify(next));
  };

  const submit = async () => {
    const round = snapshot?.round;
    if (!round || submitting || submittedRound.current === round.id) return;
    submittedRound.current = round.id;
    setSubmitting(true);
    try {
      const result = await applyDrawCountryActionFn({
        data: {
          roomId,
          playerId: credentials.playerId,
          playerToken: credentials.playerToken,
          action: { type: "drawing.submit", roundId: round.id, drawing },
        },
      });
      if (result.snapshot) live.setSnapshot(result.snapshot);
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
      | { type: "readiness.set"; ready: boolean },
  ) => {
    try {
      const result = await applyDrawCountryActionFn({
        data: {
          roomId,
          playerId: credentials.playerId,
          playerToken: credentials.playerToken,
          action,
        },
      });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.ok || !result.accepted) {
        live.setMessage(result.error);
        if (result.ok && result.errorCode === "players_not_ready" && result.snapshot) {
          const removable = result.snapshot.players.filter(
            ({ id, ready }) => !ready && id !== credentials.playerId,
          );
          if (result.snapshot.player.ready && removable.length > 0)
            setRemovePlayerIds(removable.map(({ id }) => id));
        }
      } else {
        setRemovePlayerIds(null);
        void haptics.trigger("selection");
      }
      live.notify();
    } catch {
      live.setMessage("That did not reach the room. Try once more.");
    }
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

  if (live.ended || !snapshot)
    return (
      <div className="things-game things-game--cream text-black">
        <main id="main" className="m-auto max-w-md px-6 text-center">
          <h1 className="font-serif text-4xl font-semibold">The room has gone quiet.</h1>
          <p className="mt-4 text-black/55">
            {live.message ?? "This room is no longer available."}
          </p>
          <Link
            to="/things/draw-country"
            className="mt-7 inline-flex min-h-12 items-center rounded-full bg-black px-6 font-mono text-xs text-white"
          >
            back to the game
          </Link>
        </main>
      </div>
    );

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
      </>
    );

  if (snapshot.phase === "drawing" && snapshot.round) {
    const me = snapshot.players.find(({ id }) => id === credentials.playerId);
    return (
      <div className="things-game things-game--cream text-black">
        <RoomHeader roomId={roomId} connection={live.connectionState} />
        <CountryRoundBoard
          countryName={snapshot.round.countryName}
          roundLabel={`${snapshot.round.number}/${snapshot.round.total}`}
          drawing={drawing}
          seconds={seconds}
          submitting={submitting}
          submitted={me?.submitted}
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
        connection={live.connectionState}
        onNext={() => void control({ type: "round.next" })}
      />
    );

  return <FinalRanking snapshot={snapshot} playerId={credentials.playerId} />;
}
