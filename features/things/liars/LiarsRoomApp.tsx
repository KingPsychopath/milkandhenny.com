import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useActionDialog } from "@/hooks/useActionDialog";
import { useSafeGameNavigation } from "../shared/useSafeGameNavigation";
import { GameActionDialog } from "../shared/GameActionDialog";
import { GameShell } from "../shared/GameShell";
import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  removeStorageKeys,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import {
  clearUnavailableGamePoolMembership,
  gamePoolRoomInviteUrl,
  leaveGamePoolRoom,
  useGamePoolRoomBackNavigation,
} from "../pool/pool-session.client";
import { liarsBrowserKeys } from "./liars-keys";
import {
  liarsRoleSide,
  LIARS_LAST_WORDS_LENGTH,
  LIARS_MODE_COPY,
  LIARS_PLAYER_LIMITS,
  LIARS_ROLES,
  LIARS_GRAVEYARD_NOTE_LENGTH,
  liarsActionHint,
  liarsGraveyardArmsAt,
} from "./liars-rules";
import { applyLiarsHostActionFn, applyLiarsPlayerActionFn } from "./liars-room.functions";
import { JoinLiarsRoom } from "./JoinLiarsRoom";
import { buildLiarsPlayerInviteUrl, liarsSetupPath } from "./liars-invite";
import {
  ActionButton,
  Eyebrow,
  Headline,
  KnowledgeList,
  LineupEditor,
  MarkLegend,
  LiarsOverlayLayer,
  NotesPad,
  WordPanel,
  LineupBoard,
  NightReportCard,
  PhaseTimer,
  PlayerList,
  RulesSheet,
} from "./LiarsViews";
import { useLiarsEffects } from "./useLiarsEffects";
import { useLiarsRoom } from "./useLiarsRoom";
import { LiarsVillage } from "./LiarsVillage";
import { primeLiarsAudio } from "./liars-effects.client";
import { useGameSound } from "../shared/useGameSound";
import { useLiarsNotes } from "./useLiarsNotes";
import type { LiarsPlayerCredentials, LiarsSnapshot } from "./types";
import type { LiarsNote } from "./useLiarsNotes";
import { LobbyIntro, MultiplayerLobby } from "../shared/MultiplayerLobby";
import { ThingsRoomHeader } from "../shared/RoomHeader";
import { useReliableMultiplayerAction } from "../shared/useReliableMultiplayerAction";
import { RoomUnavailableState } from "../shared/RoomUnavailableState";
import { useRoomUnavailableRecovery } from "../shared/useRoomUnavailableRecovery";

export function LiarsRoomApp({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<LiarsPlayerCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    clearExpiredGameLocalStorage();
    setCredentials(
      readExpiringLocalValue<LiarsPlayerCredentials>(liarsBrowserKeys.playerSession(roomId)),
    );
    setLoaded(true);
  }, [roomId]);

  if (!loaded) return <div className="things-game things-game--night" aria-busy="true" />;

  if (!credentials)
    return (
      <JoinLiarsRoom
        roomId={roomId}
        onJoined={(joined) => {
          writeExpiringLocalValue(liarsBrowserKeys.playerSession(roomId), joined, joined.expiresAt);
          setCredentials(joined);
        }}
      />
    );

  return (
    <LiarsRoom
      key={credentials.playerId}
      credentials={credentials}
      onUnavailable={() => {
        forgetLiarsRoomRecovery(roomId);
        void clearUnavailableGamePoolMembership("liars", roomId);
      }}
    />
  );
}

export function forgetLiarsRoomRecovery(roomId: string) {
  removeStorageKeys(localStorage, [
    liarsBrowserKeys.playerSession(roomId),
    liarsBrowserKeys.hostSession(roomId),
    liarsBrowserKeys.invite(roomId),
  ]);
}

/**
 * The whole player surface, given credentials directly. Exported so the dev harness can mount a
 * table's worth of them side by side and be looking at exactly what a player looks at, rather than
 * at a debug view that drifts from the real thing.
 */
export function LiarsRoom({
  credentials,
  onUnavailable,
}: {
  credentials: LiarsPlayerCredentials;
  onUnavailable?: () => void;
}) {
  const { roomId, playerId, playerToken } = credentials;
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const room = useLiarsRoom({
    roomId,
    playerId,
    playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const sound = useGameSound(liarsBrowserKeys.muted());
  const snapshot = room.snapshot;
  const { roomUnavailable, markUnavailable } = useRoomUnavailableRecovery({
    roomKey: roomId,
    unavailable: room.ended,
    onUnavailable,
  });
  useSafeGameNavigation(snapshot?.phase === "lobby" || snapshot?.phase === "ending");
  const roomExpiry = snapshot?.expiresAt;
  useEffect(() => {
    if (!roomExpiry) return;
    writeExpiringLocalValue(
      liarsBrowserKeys.playerSession(roomId),
      { ...credentials, expiresAt: roomExpiry },
      roomExpiry,
    );
  }, [credentials, roomExpiry, roomId]);
  useGamePoolRoomBackNavigation({
    enabled: Boolean(snapshot?.managed),
    game: "liars",
    roomId,
  });
  const isNarrator = snapshot?.narratorPlayerId === playerId;
  const notes = useLiarsNotes(roomId, playerId, snapshot?.gameNumber ?? 1);
  const { overlay } = useLiarsEffects({
    snapshot,
    clockOffset: room.clockOffset,
    effects: sound.effects,
    voice: sound.voice,
    isNarrator,
  });

  useWakeLock(Boolean(snapshot) && snapshot?.phase !== "lobby");

  const haptics = useWebHaptics();
  const previousStartRequest = useRef<string | null>(null);
  const startRequestId = snapshot?.player?.startRequestId ?? null;
  const setMessage = room.setMessage;
  useEffect(() => {
    if (!startRequestId || startRequestId === previousStartRequest.current) return;
    previousStartRequest.current = startRequestId;
    setMessage("The host wants to start — tap “I’m ready” if you stepped away.");
    void haptics.trigger("heavy");
  }, [haptics, setMessage, startRequestId]);

  const dispatchPlayerAction = useReliableMultiplayerAction(
    (action: Record<string, unknown>, actionId) =>
      applyLiarsPlayerActionFn({
        data: { roomId, playerId, playerToken, action: { ...action, actionId } },
      }),
    `${roomId}:${playerId}:${snapshot?.sequence ?? "loading"}`,
  );
  const dispatchHostAction = useReliableMultiplayerAction(
    (action: Record<string, unknown>, actionId) =>
      applyLiarsHostActionFn({
        data: { roomId, playerId, playerToken, action: { ...action, actionId } },
      }),
    `${roomId}:${playerId}:${snapshot?.sequence ?? "loading"}`,
  );

  const busyRef = useRef(false);
  const send = useCallback(
    async (action: Record<string, unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      primeLiarsAudio();
      try {
        const result = await dispatchPlayerAction(action);
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
        if (
          !result.accepted &&
          "errorCode" in result &&
          result.errorCode === "room_unavailable" &&
          action.type !== "room.leave"
        )
          markUnavailable();
        if (
          action.type === "room.leave" &&
          (result.accepted ||
            (!result.accepted && "errorCode" in result && result.errorCode === "room_unavailable"))
        ) {
          forgetLiarsRoomRecovery(roomId);
          const entrance = await leaveGamePoolRoom("liars", roomId);
          window.location.assign(entrance ?? liarsSetupPath(snapshot?.mode ?? "mafia"));
          return;
        }
      } catch {
        room.setMessage("That did not go through. Try again.");
      } finally {
        busyRef.current = false;
      }
    },
    [dispatchPlayerAction, markUnavailable, room, roomId, snapshot?.mode],
  );

  const sendHost = useCallback(
    async (action: Record<string, unknown>) => {
      try {
        const result = await dispatchHostAction(action);
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
        if (!result.accepted && "errorCode" in result && result.errorCode === "room_unavailable")
          markUnavailable();
      } catch {
        room.setMessage("That did not go through. Try again.");
      }
    },
    [dispatchHostAction, markUnavailable, room],
  );

  if (roomUnavailable)
    return (
      <GameShell tone="night">
        <RoomUnavailableState gameName="this game" gamePath="/things" />
      </GameShell>
    );

  if (!snapshot)
    return (
      <GameShell tone="night">
        <p className="m-auto font-mono text-xs text-white/50">{room.message ?? "joining…"}</p>
      </GameShell>
    );

  const you = snapshot.player;
  const isHost = snapshot.hostPlayerId === playerId;
  const dead = you ? !you.alive : false;

  return (
    <GameShell tone="night">
      <LiarsOverlayLayer overlay={overlay} />
      <div className={`flex min-h-0 flex-1 flex-col text-white ${dead ? "opacity-60" : ""}`}>
        <ThingsRoomHeader
          tone="night"
          back={
            <Link to={liarsSetupPath(snapshot.mode)}>← {LIARS_MODE_COPY[snapshot.mode].name}</Link>
          }
          roomId={snapshot.roomId}
          connection={room.connectionState}
          detail={
            snapshot.phase === "lobby"
              ? LIARS_MODE_COPY[snapshot.mode].name
              : `${snapshot.livingCount} alive · ${snapshot.players.length - snapshot.livingCount} gone`
          }
          right={
            <>
              <button
                type="button"
                onClick={sound.cycle}
                className="things-room-header-utility"
                title={sound.description}
              >
                {sound.label}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingLeave(true)}
                className="things-room-header-cta"
                aria-haspopup="dialog"
              >
                leave room
              </button>
            </>
          }
        />

        {dead ? (
          <p
            className="mx-auto w-full max-w-lg px-5 pt-3 font-mono text-micro uppercase tracking-[0.18em] text-[var(--liars-dead)]"
            role="status"
          >
            {snapshot.graveyard
              ? "you are dead · say nothing out loud · the graveyard is yours"
              : "you are dead · you can watch, you cannot vote"}
          </p>
        ) : null}

        <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-24 pt-6">
          <PhaseBody
            snapshot={snapshot}
            clockOffset={room.clockOffset}
            isHost={isHost}
            send={send}
            sendHost={sendHost}
            notes={notes.notes}
          />

          {room.message ? (
            <p className="mt-6 font-mono text-xs text-[var(--things-amber)]" role="status">
              {room.message}
            </p>
          ) : null}

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 pt-4">
            <RulesSheet mode={snapshot.mode} yourRole={you?.role} />
            {snapshot.phase !== "lobby" ? (
              <>
                {snapshot.mode === "mafia" ? <KnowledgeList snapshot={snapshot} /> : null}
                <NotesPad
                  notes={notes.notes}
                  round={snapshot.round}
                  full={notes.full}
                  onAdd={notes.add}
                  onRemove={notes.remove}
                />
              </>
            ) : null}
            {snapshot.hostDisconnectedSince !== null && !isHost ? (
              <button
                type="button"
                onClick={() => void send({ type: "host.claim" })}
                className="min-h-11 font-mono text-xs text-[var(--things-amber)]"
              >
                take over as host
              </button>
            ) : null}
            {isHost ? (
              <a
                href={`/things/liars/${snapshot.roomId}/present`}
                target="_blank"
                rel="noreferrer"
                className="min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
              >
                big screen
              </a>
            ) : null}
          </div>
          {confirmingLeave ? (
            <GameActionDialog
              tone="dark"
              eyebrow="leave room"
              title="Leave this game?"
              description={
                snapshot.phase === "lobby"
                  ? "You will give up your seat and return to the game page."
                  : "You will leave the game permanently. Your completed rounds stay in its history."
              }
              cancelLabel="stay"
              confirmLabel="leave room"
              pending={false}
              onCancel={() => setConfirmingLeave(false)}
              onConfirm={() => {
                setConfirmingLeave(false);
                void send({ type: "room.leave" });
              }}
            />
          ) : null}
        </main>
      </div>
    </GameShell>
  );
}

interface PhaseProps {
  snapshot: LiarsSnapshot;
  clockOffset: number;
  isHost: boolean;
  send: (action: Record<string, unknown>) => void | Promise<void>;
  sendHost: (action: Record<string, unknown>) => void | Promise<void>;
  /** Only used to seed the epitaph; the server never sees these. */
  notes: LiarsNote[];
}

function PhaseBody(props: PhaseProps) {
  const { snapshot } = props;
  switch (snapshot.phase) {
    case "lobby":
      return <LobbyPhase {...props} />;
    case "deal":
      return <DealPhase {...props} />;
    case "night":
      return <NightPhase {...props} />;
    case "dawn":
      return <DawnPhase {...props} />;
    case "clue":
      return <CluePhase {...props} />;
    case "deliberation":
      return <DeliberationPhase {...props} />;
    case "vote":
      return <VotePhase {...props} />;
    case "verdict":
      return <VerdictPhase {...props} />;
    case "finalGuess":
      return <FinalGuessPhase {...props} />;
    case "ending":
      return <EndingPhase {...props} />;
  }
}

function LobbyPhase({ snapshot, isHost, send, sendHost }: PhaseProps) {
  const you = snapshot.player;
  const short = LIARS_PLAYER_LIMITS[snapshot.mode].min - snapshot.players.length;
  const [startAttempted, setStartAttempted] = useState(false);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const { prompt, dialog } = useActionDialog();
  const [editingRoles, setEditingRoles] = useState(false);
  const notReady = snapshot.players.filter(({ ready }) => !ready);
  const inviteUrl =
    typeof window === "undefined"
      ? ""
      : snapshot.managed
        ? (gamePoolRoomInviteUrl("liars", snapshot.roomId) ?? "")
        : buildLiarsPlayerInviteUrl(
            window.location.origin,
            snapshot.roomId,
            readExpiringLocalValue<string>(liarsBrowserKeys.invite(snapshot.roomId)) ?? undefined,
          );
  return (
    <>
      <LobbyIntro
        title="Set the roles, then start."
        description="Everyone gets a secret role. Read the room, make your case, and find the liar."
        rules="The host sets the roles, everyone taps ready, and the phone guides the night. Talk in the room; use the game only for private information, choices, and timing."
      />
      <MultiplayerLobby
        admissionLocked={snapshot.joinLocked}
        actions={
          isHost ? (
            <>
              {startAttempted && notReady.length > 0 ? (
                <p className="mb-3 text-center font-mono text-xs text-white/45">
                  {notReady.map(({ name }) => name).join(", ")} are not ready. Tap again to deal
                  them in.
                </p>
              ) : null}
              <ActionButton
                disabled={short > 0}
                onClick={() => {
                  if (startAttempted && notReady.length > 0) {
                    setConfirmingStart(true);
                    return;
                  }
                  setStartAttempted(true);
                  void sendHost({ type: "game.start" });
                }}
              >
                {short > 0
                  ? `${short} more ${short === 1 ? "player" : "players"} needed`
                  : startAttempted && notReady.length > 0
                    ? "start anyway"
                    : "start the game"}
              </ActionButton>
            </>
          ) : (
            <p className="font-mono text-xs text-white/40">
              waiting for {snapshot.players.find(({ host }) => host)?.name ?? "the host"} to start
            </p>
          )
        }
        canPassLead={isHost && snapshot.players.length > 1}
        canSetAdmission={isHost && !snapshot.managed}
        currentPlayerId={snapshot.player?.playerId ?? null}
        inviteLabel={snapshot.managed ? "game-night invite" : "room code"}
        inviteText="Join our liars room."
        inviteTitle="Liars"
        inviteUrl={inviteUrl}
        onPassLead={(playerId) => void sendHost({ type: "host.pass", playerId })}
        onAdmissionChange={(locked) => void sendHost({ type: "room.admission.set", locked })}
        onReadyChange={(ready) => void send({ type: "readiness.set", ready })}
        onRename={async () => {
          const current =
            snapshot.players.find(({ id }) => id === snapshot.player?.playerId)?.name ?? "";
          const name = (
            await prompt({
              tone: "dark",
              eyebrow: "player name",
              title: "What should we call you?",
              description: "This name is shown to everyone in the room.",
              label: "Name",
              defaultValue: current,
              confirmLabel: "save name",
              required: true,
            })
          )?.trim();
          if (name && name !== current) void send({ type: "player.rename", name });
        }}
        players={snapshot.players.map((player) => ({
          id: player.id,
          name: player.name,
          ready: player.ready,
          lead: player.host,
          left: player.left,
        }))}
        ready={you?.ready ?? true}
        roomId={snapshot.roomId}
        settings={
          <>
            <p className="font-mono text-xs text-white/60">roles in this game</p>
            <div className="mt-3">
              {editingRoles && isHost ? (
                <LineupEditor
                  mode={snapshot.mode}
                  lineup={snapshot.lineup}
                  playerCount={snapshot.players.length}
                  wishes={snapshot.roleWishes}
                  onChange={(next) => void sendHost({ type: "game.configure", lineup: next })}
                  onReset={() => void sendHost({ type: "game.configure", resetLineup: true })}
                />
              ) : (
                <LineupBoard
                  mode={snapshot.mode}
                  lineup={snapshot.lineup}
                  playerCount={snapshot.players.length}
                  wishes={snapshot.roleWishes}
                  onWish={(role, wanted) => void send({ type: "lineup.wish", role, wanted })}
                />
              )}
            </div>
            {isHost && !snapshot.managed ? (
              <button
                type="button"
                onClick={() => setEditingRoles(!editingRoles)}
                aria-expanded={editingRoles}
                className="mt-3 min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
              >
                {editingRoles ? "done" : "add or remove roles"}
              </button>
            ) : null}
          </>
        }
      />
      {confirmingStart ? (
        <GameActionDialog
          tone="dark"
          eyebrow="players not ready"
          title="Start anyway?"
          description={`${notReady.map(({ name }) => name).join(" and ")} ${
            notReady.length === 1 ? "hasn’t" : "haven’t"
          } confirmed they’re ready. Starting now removes them before roles are dealt.`}
          cancelLabel="keep waiting"
          confirmLabel="remove and deal"
          pending={false}
          pendingLabel="starting…"
          onCancel={() => setConfirmingStart(false)}
          onConfirm={() => {
            setConfirmingStart(false);
            void sendHost({
              type: "game.start",
              removePlayerIds: notReady.map(({ id }) => id),
            });
          }}
        />
      ) : null}
      {dialog}
    </>
  );
}

/** Hold to reveal, so nobody catches your role over your shoulder. */
function DealPhase({ snapshot, clockOffset }: PhaseProps) {
  const [held, setHeld] = useState(false);
  const you = snapshot.player;
  if (!you) return null;
  const definition = LIARS_ROLES[you.role];
  const allies = snapshot.players.filter(({ id }) => you.allyIds.includes(id));

  return (
    <>
      <Eyebrow>your role</Eyebrow>
      <Headline>Hold to read it</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label="everyone reads at once"
      />
      <div
        onPointerDown={() => setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
        className="mt-6 min-h-64 select-none border-y border-white/15 py-10 text-center"
      >
        {held ? (
          <>
            <p className="font-serif text-5xl font-semibold">{definition.name}</p>
            <p className="mx-auto mt-4 max-w-sm font-serif text-base text-white/70">
              {definition.summary}
            </p>
            {you.wordCategory ? (
              <div className="mt-7">
                <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">
                  the category is
                </p>
                <p className="mt-1 font-serif text-2xl text-white/85">{you.wordCategory}</p>
              </div>
            ) : null}
            {you.word ? (
              <div className="mt-6">
                <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">
                  the word is
                </p>
                <p className="mt-2 font-serif text-5xl font-semibold leading-tight text-[var(--things-amber)] sm:text-6xl">
                  {you.word}
                </p>
              </div>
            ) : you.wordCategory ? (
              <p className="mt-6 font-serif text-xl text-[var(--liars-dead)]">
                you don't have the word — it is one of these
              </p>
            ) : null}
            {you.wordBoard.length > 0 ? (
              <p className="mt-5 font-mono text-xs text-white/35">
                the twelve it could be are on the next screen
              </p>
            ) : null}
            {allies.length > 0 ? (
              <p className="mt-6 font-mono text-xs text-white/55">
                with you · {allies.map(({ name }) => name).join(", ")}
              </p>
            ) : null}
            {/* Mafia roles need their rules on the card; an imposter's summary is the whole rule. */}
            {snapshot.mode === "mafia" ? (
              <ul className="mx-auto mt-8 max-w-sm space-y-1.5 text-left font-mono text-xs text-white/45">
                {definition.rules.map((rule, index) => (
                  <li key={index}>{rule}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="pt-16 font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            hold to reveal
          </p>
        )}
      </div>
      <p className="mt-4 font-mono text-xs text-white/30">
        everything about your role lives behind the hold, so a glance over your shoulder gets
        nothing
      </p>
    </>
  );
}

function NightPhase({ snapshot, clockOffset, send }: PhaseProps) {
  const you = snapshot.player;
  if (!you) return null;
  const definition = LIARS_ROLES[you.role];
  const hint = liarsActionHint(you.role);
  const open = snapshot.nightOpensAt !== null && Date.now() + clockOffset >= snapshot.nightOpensAt;

  if (!you.alive)
    return (
      <>
        <Eyebrow>night {snapshot.round}</Eyebrow>
        <Headline>The town sleeps</Headline>
        <p className="mt-4 font-serif text-lg text-white/60">
          Nothing to do but watch and write. The living cannot hear you.
        </p>
        <Graveyard snapshot={snapshot} send={send} />
      </>
    );

  // Until the night opens, every device shows the same thing. Whatever your role is, it is not on
  // screen yet — so a phone lying face up on the table gives nothing away in the meantime.
  if (!open)
    return (
      <>
        <Eyebrow>night {snapshot.round}</Eyebrow>
        <Headline>Screens away</Headline>
        {/*
          A countdown rather than a blank wait. Without one this screen gives no reason to move
          now, so people read it, agree with it, and keep holding the phone flat until their role
          appears — which is the exact moment it is worth something to their neighbour.

          It sits directly under the headline because that is where the action screen's timer sits.
          Measured, the two halves of the night used to put it 72px apart, so the one element that
          should be nailed down was the one that moved.
        */}
        {snapshot.nightOpensAt !== null ? (
          <PhaseTimer
            endsAt={snapshot.nightOpensAt}
            clockOffset={clockOffset}
            label="your role appears in"
            big
          />
        ) : null}
        <p className="mt-6 font-serif text-xl text-white/80">
          Turn your phone away from the person next to you.
        </p>
        <p className="mt-3 font-mono text-xs text-white/40">
          everybody acts at once, so nobody can be timed
        </p>
      </>
    );

  return (
    <>
      <Eyebrow>night {snapshot.round}</Eyebrow>
      {/*
        The headline is the same words for everybody, and that is the point.
        `who dies tonight` set in forty-point serif is legible from the other side of a table, so
        the largest type on the screen was the single most role-revealing string in the game — while
        the deal card two minutes earlier had been hold-to-reveal precisely to avoid that. The
        jester already borrowed the villager's label, so the intent existed; it just stopped at the
        one screen that is up for forty-five seconds.

        The label still has to be readable to act on, so it moves down to where a form label sits,
        at a size that needs actually looking rather than glancing.
      */}
      <Headline>Choose someone</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label="night ends in"
        big
      />

      {you.report ? <NightReportCard report={you.report} /> : null}

      <div className="mt-6">
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">
          {definition.actionLabel ?? "nothing tonight"}
        </p>
        {hint ? <p className="mb-3 mt-1 font-serif text-base text-white/50">{hint}</p> : null}
        <PlayerList
          snapshot={snapshot}
          selectedId={you.nightTarget}
          selectableIds={you.nightLocked || !open ? [] : you.targetableIds}
          onSelect={(targetId) =>
            void send({
              type: "night.select",
              round: snapshot.round,
              targetId: you.nightTarget === targetId ? null : targetId,
            })
          }
        />
      </div>

      {you.allyTargets.length > 0 ? (
        <div className="mt-6 border-t border-white/10 pt-3">
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/35">with you</p>
          <ul className="mt-2 font-mono text-xs text-white/55">
            {you.allyTargets.map((ally) => {
              const name = snapshot.players.find(({ id }) => id === ally.playerId)?.name;
              const target = snapshot.players.find(({ id }) => id === ally.targetId)?.name;
              return (
                <li key={ally.playerId} className="flex gap-2 py-1">
                  <span className="w-24 shrink-0">{name}</span>
                  <span className={ally.locked ? "text-[var(--things-amber)]" : ""}>
                    {target ?? "hasn't chosen"}
                    {ally.locked ? " · locked" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 font-mono text-xs text-white/30">
            {you.callerPlayerId === you.playerId
              ? "if you disagree, yours is the one that happens"
              : `if you disagree, ${
                  snapshot.players.find(({ id }) => id === you.callerPlayerId)?.name ?? "the eldest"
                } decides`}
          </p>
        </div>
      ) : null}

      <LiarsVillage snapshot={snapshot} clockOffset={clockOffset} />

      <p className="mt-6 font-mono text-xs text-white/40" aria-live="polite">
        {snapshot.actedCount} of {snapshot.livingCount} have acted
      </p>

      <div className="mt-4">
        <ActionButton
          disabled={you.nightLocked || !open}
          onClick={() => void send({ type: "night.lock", round: snapshot.round })}
        >
          {you.nightLocked
            ? "locked in"
            : you.nightTarget
              ? "lock it in"
              : liarsRoleSide(you.role) === "mafia"
                ? "nobody dies tonight"
                : "do nothing tonight"}
        </ActionButton>
      </div>
    </>
  );
}

/**
 * The headline slot holds the answer on every screen, so it holds it here too. Until the name
 * lands it says "Morning"; after, it says who. The story goes underneath as prose — it is the part
 * you listen to rather than the part you look for.
 */
function dawnHeadline(dawn: LiarsSnapshot["dawn"], landed: boolean, revived: boolean): string {
  if (!dawn || !landed) return "Morning";
  const substituted = dawn.deaths.find(({ substituteName }) => substituteName);
  if (substituted) return `${substituted.substituteName} is gone`;
  const saved = dawn.deaths.find(({ revived: wasRevived }) => wasRevived);
  if (saved) return revived ? `${saved.name} lives` : `${saved.name} is gone`;
  const dead = dawn.deaths.filter(({ revived: wasRevived }) => !wasRevived);
  if (dead.length === 0) return "Nobody died";
  if (dead.length === 1) return `${dead[0].name} is gone`;
  return `${dead.map(({ name }) => name).join(" and ")} are gone`;
}

function DawnPhase({ snapshot, clockOffset, send, notes }: PhaseProps) {
  const dawn = snapshot.dawn;
  const you = snapshot.player;
  const now = Date.now() + clockOffset;
  const landed = dawn ? now >= dawn.nameLandsAt : false;
  const revived = dawn?.reviveAt !== null && dawn !== null ? now >= dawn.reviveAt! : false;

  return (
    <>
      <Eyebrow>dawn · day {snapshot.round}</Eyebrow>
      <Headline>{dawnHeadline(dawn, landed, revived)}</Headline>
      {dawn ? (
        <p className="mt-4 font-serif text-lg leading-relaxed text-white/65">{dawn.narration}</p>
      ) : null}

      {dawn && landed ? (
        <div className="mt-8 space-y-3" aria-live="assertive">
          {dawn.deaths.map((death) => (
            <p
              key={death.playerId}
              className={`font-serif text-2xl ${
                death.revived && revived ? "text-[var(--liars-alive)]" : "text-[var(--liars-dead)]"
              }`}
            >
              {death.name}
              {death.substituteName
                ? ` — ${death.substituteName} stepped in front of them`
                : death.revived
                  ? revived
                    ? " lives"
                    : " is gone"
                  : " is gone"}
              {death.role ? (
                <span className="ml-2 font-mono text-xs uppercase tracking-[0.14em] text-white/45">
                  {LIARS_ROLES[death.role].name}
                </span>
              ) : null}
            </p>
          ))}
          {dawn.witnessCount ? (
            <p className="font-mono text-xs text-white/50">
              {dawn.witnessCount} {dawn.witnessCount === 1 ? "person" : "people"} saw it happen
            </p>
          ) : null}
          {dawn.movementSeen.map((name) => (
            <p key={name} className="font-mono text-xs text-white/50">
              {name} was seen moving last night
            </p>
          ))}
          {dawn.lastWords.map((entry, index) => (
            <p key={index} className="font-serif text-lg text-white/75">
              “{entry.text}” — {entry.name}
            </p>
          ))}
        </div>
      ) : null}

      <LiarsVillage snapshot={snapshot} clockOffset={clockOffset} />

      {you && !you.alive && you.lastWordsOpen ? <LastWords send={send} notes={notes} /> : null}
    </>
  );
}

/**
 * Your last words start as the last thing you wrote in your notebook. Most people die with
 * something half-formed in there, and the line they happened to be looking at when it happened
 * makes a better epitaph than anything they would compose in thirty seconds. Fully editable — it
 * is a starting point, not a confession.
 */
function LastWords({ send, notes }: { send: PhaseProps["send"]; notes: LiarsNote[] }) {
  const [text, setText] = useState(() => notes.at(-1)?.text ?? "");
  const [sent, setSent] = useState(false);
  if (sent)
    return <p className="mt-8 font-mono text-xs text-white/45">your words are with them now</p>;

  return (
    <form
      className="mt-8 border-y border-white/15 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        void send({ type: "words.last", text: text.trim() });
        setSent(true);
      }}
    >
      <label className="block font-mono text-xs text-white/55">
        <span className="block pb-2">
          last words · one line, and you may lie
          {notes.length > 0 ? " · your notebook was open at this" : ""}
        </span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={LIARS_LAST_WORDS_LENGTH}
          autoComplete="off"
          className="min-h-12 w-full border-b border-white/25 bg-transparent font-serif text-lg text-white outline-none focus-visible:border-[var(--things-amber)]"
        />
      </label>
      <div className="mt-4">
        <ActionButton onClick={() => undefined} disabled={!text.trim()}>
          say it
        </ActionButton>
      </div>
    </form>
  );
}

function CluePhase({ snapshot, send }: PhaseProps) {
  const you = snapshot.player;
  const clue = snapshot.clue;
  if (!clue || !you) return null;
  const current = snapshot.players.find(({ id }) => id === clue.currentPlayerId);
  const yours = clue.currentPlayerId === you.playerId;
  // Round a table you can hear whose turn it is. On a call you cannot, and two people talking over
  // each other costs the whole round — so the screen has to do the work the room was doing.
  const oneTap = clue.handoff === "one-tap";
  const confirms = clue.finishedBy.length;
  const confirmedByYou = clue.finishedBy.includes(you.playerId);
  const confirmNames = clue.finishedBy
    .map((id) => snapshot.players.find((player) => player.id === id)?.name)
    .filter(Boolean)
    .join(" and ");
  const nextUp = clue.order[clue.order.indexOf(clue.currentPlayerId ?? "") + 1];
  const nextName = snapshot.players.find(({ id }) => id === nextUp)?.name;

  return (
    <>
      <Eyebrow>clues · round {clue.round}</Eyebrow>
      <Headline>
        {oneTap ? "Go round the circle" : yours ? "Your turn" : `${current?.name ?? "…"}'s turn`}
      </Headline>
      <p className="mt-4 font-serif text-lg text-white/65">
        {oneTap
          ? "One word each, out loud, in this order. Nobody needs to touch a phone until the end."
          : yours
            ? "Unmute, say one word, then tap."
            : `Stay muted until ${current?.name ?? "they"} have finished.`}
      </p>

      {oneTap ? (
        /* Round a table nobody needs to confirm a turn you can hear. One tap when the circle has
           been all the way round, from whoever is holding their phone. */
        <div className="mt-8">
          <ActionButton
            tone={confirmedByYou ? "ghost" : "amber"}
            disabled={confirmedByYou}
            onClick={() => void send({ type: "clue.allSaid", round: snapshot.round })}
          >
            {confirmedByYou ? "waiting for one more" : "everyone has said theirs →"}
          </ActionButton>
          <p className="mt-3 text-center font-mono text-xs text-white/35">
            {confirms === 0
              ? "any two of you can end the round"
              : confirmedByYou
                ? "somebody else needs to agree"
                : `${confirmNames} says the circle is done — tap to agree`}
          </p>
        </div>
      ) : yours ? (
        <div className="mt-8">
          <ActionButton onClick={() => void send({ type: "clue.said", round: snapshot.round })}>
            said it →
          </ActionButton>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {nextName && nextUp === you.playerId ? (
            <p className="font-mono text-xs text-[var(--things-amber)]">
              you are next — unmute now so there is no gap
            </p>
          ) : null}
          <button
            type="button"
            onClick={() =>
              void send({
                type: "clue.skip",
                round: snapshot.round,
                playerId: clue.currentPlayerId ?? "",
              })
            }
            className="min-h-11 font-mono text-xs text-white/35 hover:text-white/70"
          >
            {current?.name} has gone quiet — move on
          </button>
        </div>
      )}

      <WordPanel word={you.word} category={you.wordCategory} board={you.wordBoard} />

      {/* One line rather than sixteen bordered rows. The order is randomised so the phone is the
          only place to read it, but reading it is a glance, not a list to work through. */}
      <p className="mt-6 font-mono text-xs leading-relaxed text-white/40">
        {clue.order.map((playerId, index) => {
          const player = snapshot.players.find(({ id }) => id === playerId);
          const done = clue.doneIds.includes(playerId);
          const isYou = playerId === you.playerId;
          const isNow = !oneTap && playerId === clue.currentPlayerId;
          return (
            <span key={playerId}>
              {index > 0 ? " · " : ""}
              <span
                className={
                  isNow
                    ? "font-bold text-[var(--things-amber)]"
                    : isYou
                      ? "text-white/80"
                      : done
                        ? "text-white/20"
                        : ""
                }
              >
                {isYou ? "you" : player?.name}
              </span>
            </span>
          );
        })}
      </p>
    </>
  );
}

function DeliberationPhase({ snapshot, clockOffset, send, isHost, sendHost }: PhaseProps) {
  const you = snapshot.player;
  const living = snapshot.players.filter(({ alive }) => alive).map(({ id }) => id);

  /*
    The dead were being handed the living's screen: a headline telling them to talk, an instruction
    to say who they think it is, and a roster they cannot touch — then the graveyard underneath it.
    Every word of that is an invitation to speak out loud, which is the one thing a dead player must
    not do. So they get their own, shorter, and the roster comes off: the graveyard already lists
    exactly the people they can act on, and printing the same names twice on one screen was the
    repetition rather than a second view of anything.
  */
  if (you && !you.alive)
    return (
      <>
        <Eyebrow>day {snapshot.round}</Eyebrow>
        <Headline>Not a word</Headline>
        <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="they vote in" />
        <p className="mt-4 font-serif text-lg text-white/60">
          You know things the living do not, and you cannot tell them any of it. Watch them work it
          out. Everything you have goes on the board.
        </p>
        <Graveyard snapshot={snapshot} send={send} />
      </>
    );

  return (
    <>
      <Eyebrow>day {snapshot.round}</Eyebrow>
      <Headline>Talk</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label="vote opens in"
        big
      />
      <p className="mt-4 font-serif text-lg text-white/65">
        Say who you think it is, and why. Point at someone to put them on the spot — everyone sees
        it, nobody is bound by it. The vote comes next.
      </p>

      <div className="mt-6">
        <PlayerList
          snapshot={snapshot}
          selectedId={you?.pointedAt}
          selectableIds={you?.alive ? living.filter((id) => id !== you.playerId) : []}
          onSelect={(targetId) =>
            void send({
              type: "day.point",
              round: snapshot.round,
              targetId: you?.pointedAt === targetId ? null : targetId,
            })
          }
        />
        <MarkLegend marks={snapshot.players.flatMap(({ marks }) => marks)} />
      </div>

      {you?.alive ? (
        <div className="mt-8">
          <ActionButton
            tone={you.readyToVote ? "ghost" : "amber"}
            onClick={() =>
              void send({
                type: "day.readyToVote",
                round: snapshot.round,
                ready: !you.readyToVote,
              })
            }
          >
            {you.readyToVote ? "waiting for the rest" : "ready to vote"}
          </ActionButton>
          <p className="mt-3 text-center font-mono text-xs text-white/40">
            {snapshot.readyToVoteCount} of {snapshot.livingCount} ready
          </p>
        </div>
      ) : null}

      {isHost ? (
        <button
          type="button"
          onClick={() => void sendHost({ type: "phase.extend" })}
          className="mt-6 min-h-11 font-mono text-xs text-white/40 hover:text-white/70"
        >
          + 30 seconds
        </button>
      ) : null}
    </>
  );
}

/** Public arithmetic: everyone can already count the dead, so saying it out loud leaks nothing. */
function graveyardArmedFor(snapshot: LiarsSnapshot) {
  if (!snapshot.toggles.graveyardVote || snapshot.toggles.liveGodView) return false;
  const dead = snapshot.players.filter(({ alive }) => !alive).length;
  return dead >= liarsGraveyardArmsAt(snapshot.players.length);
}

function VotePhase({ snapshot, clockOffset, send }: PhaseProps) {
  const you = snapshot.player;
  const living = snapshot.players.filter(({ alive }) => alive).map(({ id }) => id);

  if (!you?.alive)
    return (
      <>
        <Eyebrow>day {snapshot.round}</Eyebrow>
        <Headline>They are voting</Headline>
        <p className="mt-4 font-serif text-lg text-white/60">Say nothing. Cast yours.</p>
        <Graveyard snapshot={snapshot} send={send} />
      </>
    );

  return (
    <>
      <Eyebrow>day {snapshot.round}</Eyebrow>
      <Headline>
        {snapshot.history.at(-1)?.text.startsWith("Level") ? "Vote again" : "Vote"}
      </Headline>
      <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="closes in" big />
      <p className="mt-4 font-serif text-lg text-white/65">
        Nobody sees this until everyone has committed.
      </p>
      {/*
        The living are told the graveyard is armed and never told what it did. Both halves matter.
        The count of the dead is already on everyone's screen, so this leaks nothing — but knowing
        an unseen ballot is in the box changes how a table argues, and never seeing it land means a
        4–3 lynch might have been 3–3 plus the dead, and nobody will ever know which.
      */}
      {graveyardArmedFor(snapshot) ? (
        <p className="mt-2 font-mono text-xs text-[var(--things-amber)]/70">
          the graveyard is voting too — you will not see which way
        </p>
      ) : null}

      <div className="mt-6">
        <PlayerList
          snapshot={snapshot}
          selectedId={you.vote}
          selectableIds={you.voteLocked ? [] : living}
          onSelect={(targetId) =>
            void send({
              type: "vote.cast",
              round: snapshot.round,
              targetId: you.vote === targetId ? null : targetId,
            })
          }
        />
      </div>

      <div className="mt-8">
        <ActionButton
          disabled={you.voteLocked}
          onClick={() => void send({ type: "vote.lock", round: snapshot.round })}
        >
          {you.voteLocked ? "locked in" : you.vote ? "lock my vote" : "abstain"}
        </ActionButton>
      </div>
    </>
  );
}

function VerdictPhase({ snapshot, clockOffset }: PhaseProps) {
  const ejected = snapshot.players.find(
    ({ deathCause, deathRound }) => deathCause === "ejected" && deathRound === snapshot.round,
  );

  return (
    <>
      <Eyebrow>verdict · day {snapshot.round}</Eyebrow>
      <Headline>{ejected ? `${ejected.name} is out` : "Nobody goes"}</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label={snapshot.mode === "mafia" ? "night falls in" : "next round in"}
      />
      <p className="mt-4 font-serif text-lg text-white/65">
        {ejected?.role
          ? `${ejected.name} was the ${LIARS_ROLES[ejected.role].name}.`
          : "The vote was level twice. Everybody stays."}
      </p>
      <div className="mt-8">
        <PlayerList snapshot={snapshot} />
      </div>
    </>
  );
}

function FinalGuessPhase({ snapshot, clockOffset, send }: PhaseProps) {
  const [guess, setGuess] = useState("");
  const you = snapshot.player;

  if (!you?.finalGuessOpen)
    return (
      <>
        <Eyebrow>caught</Eyebrow>
        <Headline>One guess left</Headline>
        <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="they have" />
        <p className="mt-4 font-serif text-lg text-white/65">
          They have thirty seconds to name the word. If they get it, they take the whole game.
        </p>
      </>
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (guess.trim()) void send({ type: "guess.final", text: guess.trim() });
      }}
    >
      <Eyebrow>you are caught</Eyebrow>
      <Headline>Name the word</Headline>
      <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="you have" />
      <input
        value={guess}
        onChange={(event) => setGuess(event.target.value)}
        maxLength={60}
        autoFocus
        autoComplete="off"
        className="mt-8 min-h-14 w-full border-b border-white/25 bg-transparent font-serif text-3xl text-white outline-none focus-visible:border-[var(--things-amber)]"
      />
      <div className="mt-8">
        <ActionButton onClick={() => undefined} disabled={!guess.trim()}>
          that's it
        </ActionButton>
      </div>
    </form>
  );
}

function EndingPhase({ snapshot, isHost, sendHost }: PhaseProps) {
  const ending = snapshot.ending;
  if (!ending) return null;

  return (
    <>
      <Eyebrow>game {snapshot.gameNumber}</Eyebrow>
      <Headline>{ending.headline}</Headline>
      {ending.word ? (
        <p className="mt-4 font-serif text-xl text-[var(--things-amber)]">
          the word was {ending.word}
        </p>
      ) : null}

      <div className="mt-8">
        <Eyebrow>what happened</Eyebrow>
        <ol className="mt-3 space-y-2 font-serif text-base leading-relaxed text-white/70">
          {ending.log.map((entry, index) => (
            <li key={index} className="flex gap-3">
              <span className="w-14 shrink-0 pt-1 font-mono text-micro uppercase tracking-[0.14em] text-white/25">
                {entry.phase} {entry.round}
              </span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-10">
        <Eyebrow>who everyone was</Eyebrow>
      </div>
      <ul className="mt-3 border-t border-white/10">
        {ending.roles.map(({ playerId, name, role }) => (
          <li key={playerId} className="flex min-h-12 items-center gap-3 border-b border-white/10">
            <span className="font-serif text-lg">{name}</span>
            <span className="ml-auto font-mono text-xs uppercase tracking-[0.14em] text-white/55">
              {LIARS_ROLES[role].name}
            </span>
          </li>
        ))}
      </ul>

      {ending.awards.length > 0 ? (
        <div className="mt-10">
          <Eyebrow>awards</Eyebrow>
          <ul className="mt-3 font-mono text-xs text-white/55">
            {ending.awards.map((award, index) => (
              <li key={index} className="flex gap-3 py-1.5">
                <span className="w-28 shrink-0 text-white/30">{award.label}</span>
                <span>
                  {award.name} · {award.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isHost ? (
        <div className="mt-10 space-y-3">
          <ActionButton onClick={() => void sendHost({ type: "game.replay" })}>
            again, same people
          </ActionButton>
          <ActionButton tone="ghost" onClick={() => void sendHost({ type: "game.lobby" })}>
            back to the lobby
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

/** Opens the moment you die. It just does not count until half the table is gone. */
function Graveyard({ snapshot, send }: { snapshot: LiarsSnapshot; send: PhaseProps["send"] }) {
  const graveyard = snapshot.graveyard;
  if (!graveyard) return null;
  const living = snapshot.players.filter(({ alive }) => alive);
  const armsAt = liarsGraveyardArmsAt(snapshot.players.length);

  return (
    <section className="mt-10 border-t border-white/10 pt-5" aria-label="the graveyard">
      <Eyebrow>the graveyard</Eyebrow>
      {graveyard.armed ? (
        <>
          <p className="mt-2 font-serif text-lg text-[var(--things-amber)]">
            You are one ballot now. Together.
          </p>
          <p className="mt-1 font-mono text-xs text-white/45">
            {graveyard.deadlocked
              ? "split — as it stands the graveyard says nothing"
              : graveyard.abstaining > 0
                ? `${graveyard.abstaining} of you ${graveyard.abstaining === 1 ? "has" : "have"} not voted`
                : "agreed · it goes in with the living's"}
          </p>
        </>
      ) : (
        <p className="mt-2 font-mono text-xs text-white/45">
          {`${graveyard.deadCount} of ${armsAt} · vote anyway — it starts counting the moment there are ${armsAt} of you`}
        </p>
      )}
      <ul className="mt-4 border-t border-white/10">
        {living.map((player) => {
          const votes = graveyard.tally.find(({ playerId }) => playerId === player.id)?.votes ?? 0;
          return (
            <li key={player.id} className="border-b border-white/10">
              <button
                type="button"
                onClick={() =>
                  void send({
                    type: "graveyard.vote",
                    round: snapshot.round,
                    targetId: graveyard.yourVote === player.id ? null : player.id,
                  })
                }
                className="flex min-h-12 w-full items-center gap-3 text-left"
              >
                <span
                  aria-hidden="true"
                  className={`h-7 w-0.5 rounded-full ${
                    graveyard.yourVote === player.id ? "bg-[var(--things-amber)]" : "bg-transparent"
                  }`}
                />
                <span className="font-serif text-lg">{player.name}</span>
                {votes > 0 ? (
                  <span className="ml-auto font-mono text-xs text-white/50">{votes}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <GraveyardBoard graveyard={graveyard} send={send} />
    </section>
  );
}

/**
 * The board.
 *
 * The dead are the only people in this game with nothing to do and everything to say, and left to
 * themselves they will say it out loud to a living room that can hear them. So give them somewhere
 * to put it — but a corkboard rather than a chat. Eight lines, pinned, oldest falling off. A
 * scrolling conversation is where a dead table solves the game completely and then casts a ballot
 * with perfect information; eight lines make them decide what actually mattered.
 */
function GraveyardBoard({
  graveyard,
  send,
}: {
  graveyard: NonNullable<LiarsSnapshot["graveyard"]>;
  send: PhaseProps["send"];
}) {
  const [draft, setDraft] = useState("");

  const pin = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send({ type: "graveyard.pin", text });
  };

  return (
    <div className="mt-6 border-t border-white/10 pt-4">
      <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
        the board · {graveyard.board.length}/{graveyard.boardMax} · only the dead see this
      </p>
      {graveyard.board.length > 0 ? (
        <ul className="mt-2">
          {graveyard.board.map((note) => (
            <li key={note.id} className="flex items-baseline gap-3 border-b border-white/10 py-2">
              <span className="w-16 shrink-0 truncate font-mono text-micro text-white/35">
                {note.name}
              </span>
              <span className="flex-1 font-serif text-base text-white/75">{note.text}</span>
              <button
                type="button"
                aria-label={`unpin ${note.text}`}
                onClick={() => void send({ type: "graveyard.unpin", noteId: note.id })}
                className="min-h-11 px-2 font-mono text-xs text-white/25 hover:text-white/60"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") pin();
          }}
          maxLength={LIARS_GRAVEYARD_NOTE_LENGTH}
          placeholder="pin what you worked out"
          className="min-h-11 flex-1 border-b border-white/15 bg-transparent font-serif text-base text-white outline-none placeholder:text-white/25 focus:border-[var(--things-amber)]"
        />
        <button
          type="button"
          onClick={pin}
          disabled={draft.trim().length === 0}
          className="min-h-11 shrink-0 px-3 font-mono text-xs text-[var(--things-amber)] disabled:text-white/20"
        >
          pin
        </button>
      </div>
    </div>
  );
}
