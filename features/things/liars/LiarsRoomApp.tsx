import { useCallback, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useWakeLock } from "@/hooks/useWakeLock";
import { GameShell } from "../shared/GameShell";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { liarsBrowserKeys } from "./liars-keys";
import {
  LIARS_LAST_WORDS_LENGTH,
  LIARS_MODE_COPY,
  LIARS_PLAYER_LIMITS,
  LIARS_ROLES,
  liarsGraveyardArmsAt,
} from "./liars-rules";
import { applyLiarsHostActionFn, applyLiarsPlayerActionFn } from "./liars-room.functions";
import { JoinLiarsRoom } from "./JoinLiarsRoom";
import {
  ActionButton,
  Eyebrow,
  Headline,
  KnowledgeList,
  LiarsOverlayLayer,
  NotesPad,
  LineupBoard,
  NightReportCard,
  PhaseTimer,
  PlayerList,
  RulesSheet,
} from "./LiarsViews";
import { useLiarsEffects } from "./useLiarsEffects";
import { useLiarsRoom } from "./useLiarsRoom";
import { primeLiarsAudio } from "./liars-effects.client";
import { useGameSound } from "../shared/useGameSound";
import { useLiarsNotes } from "./useLiarsNotes";
import type { LiarsPlayerCredentials, LiarsSnapshot } from "./types";
import type { LiarsNote } from "./useLiarsNotes";

let actionCounter = 0;
const nextActionId = () => `${Date.now().toString(36)}-${(actionCounter += 1)}`;

export function LiarsRoomApp({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<LiarsPlayerCredentials | null>(() => {
    if (typeof window === "undefined") return null;
    return readExpiringLocalValue<LiarsPlayerCredentials>(liarsBrowserKeys.playerSession(roomId));
  });

  if (!credentials)
    return (
      <JoinLiarsRoom
        roomId={roomId}
        onJoined={(joined) => {
          writeExpiringLocalValue(
            liarsBrowserKeys.playerSession(roomId),
            joined,
            joined.expiresAt,
          );
          setCredentials(joined);
        }}
      />
    );

  return <LiarsRoom key={credentials.playerId} credentials={credentials} />;
}

/**
 * The whole player surface, given credentials directly. Exported so the dev harness can mount a
 * table's worth of them side by side and be looking at exactly what a player looks at, rather than
 * at a debug view that drifts from the real thing.
 */
export function LiarsRoom({ credentials }: { credentials: LiarsPlayerCredentials }) {
  const { roomId, playerId, playerToken } = credentials;
  const room = useLiarsRoom({
    roomId,
    playerId,
    playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const sound = useGameSound(liarsBrowserKeys.muted());
  const snapshot = room.snapshot;
  const isNarrator = snapshot?.narratorPlayerId === playerId;
  const notes = useLiarsNotes(roomId, snapshot?.gameNumber ?? 1);
  const { overlay } = useLiarsEffects({
    snapshot,
    clockOffset: room.clockOffset,
    effects: sound.effects,
    voice: sound.voice,
    isNarrator,
  });

  useWakeLock(Boolean(snapshot) && snapshot?.phase !== "lobby");

  const busyRef = useRef(false);
  const send = useCallback(
    async (action: Record<string, unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      primeLiarsAudio();
      try {
        const result = await applyLiarsPlayerActionFn({
          data: {
            roomId,
            playerId,
            playerToken,
            action: { actionId: nextActionId(), ...action },
          },
        });
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
      } catch {
        room.setMessage("That did not go through. Try again.");
      } finally {
        busyRef.current = false;
      }
    },
    [playerId, playerToken, room, roomId],
  );

  const sendHost = useCallback(
    async (action: Record<string, unknown>) => {
      try {
        const result = await applyLiarsHostActionFn({
          data: {
            roomId,
            playerId,
            playerToken,
            action: { actionId: nextActionId(), ...action },
          },
        });
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
      } catch {
        room.setMessage("That did not go through. Try again.");
      }
    },
    [playerId, playerToken, room, roomId],
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
        <header className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-5 pt-4 font-mono text-xs text-white/45">
          <Link to="/things/liars" className="inline-flex min-h-11 items-center">
            ← liars
          </Link>
          <span className="tracking-[0.16em]">{snapshot.roomId}</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={sound.cycle}
              className="min-h-11 hover:text-white/80"
              title={sound.description}
            >
              {sound.label}
            </button>
            {snapshot.phase !== "lobby" ? (
              <span>
                {snapshot.livingCount} alive ·{" "}
                {snapshot.players.length - snapshot.livingCount} gone
              </span>
            ) : null}
          </span>
        </header>

        {dead ? (
          <p
            className="mx-auto w-full max-w-lg px-5 pt-3 font-mono text-micro uppercase tracking-[0.18em] text-[var(--liars-dead)]"
            role="status"
          >
            you are dead · you can watch, you cannot vote
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
                <KnowledgeList snapshot={snapshot} />
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
            {room.connectionState !== "connected" ? (
              <span className="font-mono text-xs text-white/30">{room.connectionState}</span>
            ) : null}
          </div>
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
  return (
    <>
      <Eyebrow>{LIARS_MODE_COPY[snapshot.mode].name} · lobby</Eyebrow>
      <Headline>Who is here</Headline>
      <div className="mt-6">
        <PlayerList snapshot={snapshot} />
      </div>

      <div className="mt-10">
        <Eyebrow>roles in this game</Eyebrow>
        <div className="mt-3">
          <LineupBoard
            mode={snapshot.mode}
            lineup={snapshot.lineup}
            playerCount={snapshot.players.length}
          />
        </div>
      </div>

      <div className="mt-10 space-y-3">
        <ActionButton
          tone={you?.ready ? "ghost" : "amber"}
          onClick={() => void send({ type: "readiness.set", ready: !you?.ready })}
        >
          {you?.ready ? "ready" : "i'm ready"}
        </ActionButton>
        {isHost ? (
          <ActionButton
            disabled={short > 0}
            onClick={() => void sendHost({ type: "game.start" })}
          >
            {short > 0
              ? `${short} more ${short === 1 ? "player" : "players"} needed`
              : "start the game"}
          </ActionButton>
        ) : null}
      </div>
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
            {you.word ? (
              <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
                the word is {you.word}
              </p>
            ) : null}
            {allies.length > 0 ? (
              <p className="mt-6 font-mono text-xs text-white/55">
                with you · {allies.map(({ name }) => name).join(", ")}
              </p>
            ) : null}
            <ul className="mx-auto mt-8 max-w-sm space-y-1.5 text-left font-mono text-xs text-white/45">
              {definition.rules.map((rule, index) => (
                <li key={index}>{rule}</li>
              ))}
            </ul>
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
  const open = snapshot.nightOpensAt !== null && Date.now() + clockOffset >= snapshot.nightOpensAt;

  if (!you.alive)
    return (
      <>
        <Eyebrow>night {snapshot.round}</Eyebrow>
        <Headline>The town sleeps</Headline>
        <Graveyard snapshot={snapshot} send={send} />
      </>
    );

  // Until the night opens, every device shows the same thing. Whatever your role is, it is not on
  // screen yet — so a phone lying face up on the table gives nothing away in the meantime.
  if (!open)
    return (
      <>
        <Eyebrow>night {snapshot.round}</Eyebrow>
        <Headline>Night falls</Headline>
        <p className="mt-4 font-serif text-lg text-white/65">
          Turn your screen away from the person next to you.
        </p>
      </>
    );

  return (
    <>
      <Eyebrow>night {snapshot.round}</Eyebrow>
      <Headline>{definition.actionLabel ?? "wait"}</Headline>
      <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="night ends in" />

      {you.report ? <NightReportCard report={you.report} /> : null}

      <div className="mt-6">
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
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/35">
            with you
          </p>
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
              : "stay in"}
        </ActionButton>
      </div>
    </>
  );
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
      <Headline>{dawn?.narration ?? "Morning"}</Headline>

      {dawn && landed ? (
        <div className="mt-8 space-y-3" aria-live="assertive">
          {dawn.deaths.map((death) => (
            <p
              key={death.playerId}
              className={`font-serif text-2xl ${
                death.revived && revived
                  ? "text-[var(--liars-alive)]"
                  : "text-[var(--liars-dead)]"
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

      {you && !you.alive && you.lastWordsOpen ? (
        <LastWords send={send} notes={notes} />
      ) : null}

      <div className="mt-8">
        <PlayerList snapshot={snapshot} />
      </div>
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

  return (
    <>
      <Eyebrow>
        clues · round {clue.round}
        {you.word ? ` · your word is ${you.word}` : " · you have no word"}
      </Eyebrow>
      <Headline>{yours ? "Your turn" : `${current?.name ?? "…"}'s turn`}</Headline>
      <p className="mt-4 font-serif text-lg text-white/65">
        {yours
          ? "Say one word out loud, then tap."
          : "Listen. Your turn is coming."}
      </p>

      {yours ? (
        <div className="mt-8">
          <ActionButton onClick={() => void send({ type: "clue.said", round: snapshot.round })}>
            said it →
          </ActionButton>
        </div>
      ) : null}

      <ol className="mt-10 border-t border-white/10">
        {clue.order.map((playerId, index) => {
          const player = snapshot.players.find(({ id }) => id === playerId);
          const done = clue.doneIds.includes(playerId);
          return (
            <li
              key={playerId}
              className={`flex min-h-12 items-center gap-3 border-b border-white/10 ${
                done ? "opacity-40" : playerId === clue.currentPlayerId ? "" : "opacity-70"
              }`}
            >
              <span className="w-6 font-mono text-xs text-white/30">{index + 1}</span>
              <span className="font-serif text-lg">{player?.name}</span>
              {playerId === clue.currentPlayerId ? (
                <span className="ml-auto font-mono text-micro uppercase tracking-[0.16em] text-[var(--things-amber)]">
                  now
                </span>
              ) : done ? (
                <span className="ml-auto font-mono text-xs text-white/30">said</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function DeliberationPhase({ snapshot, clockOffset, send, isHost, sendHost }: PhaseProps) {
  const you = snapshot.player;
  const living = snapshot.players.filter(({ alive }) => alive).map(({ id }) => id);

  return (
    <>
      <Eyebrow>day {snapshot.round}</Eyebrow>
      <Headline>Talk</Headline>
      <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="vote opens in" />
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
      ) : (
        <Graveyard snapshot={snapshot} send={send} />
      )}

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

function VotePhase({ snapshot, clockOffset, send }: PhaseProps) {
  const you = snapshot.player;
  const living = snapshot.players.filter(({ alive }) => alive).map(({ id }) => id);

  if (!you?.alive)
    return (
      <>
        <Eyebrow>day {snapshot.round}</Eyebrow>
        <Headline>They are voting</Headline>
        <Graveyard snapshot={snapshot} send={send} />
      </>
    );

  return (
    <>
      <Eyebrow>day {snapshot.round}</Eyebrow>
      <Headline>Vote</Headline>
      <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="closes in" />
      <p className="mt-4 font-serif text-lg text-white/65">
        Nobody sees this until everyone has committed.
      </p>

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

function VerdictPhase({ snapshot }: PhaseProps) {
  const ejected = snapshot.players.find(
    ({ deathCause, deathRound }) => deathCause === "ejected" && deathRound === snapshot.round,
  );

  return (
    <>
      <Eyebrow>verdict · day {snapshot.round}</Eyebrow>
      <Headline>
        {ejected
          ? `${ejected.name} is out`
          : "The town could not agree"}
      </Headline>
      {ejected?.role ? (
        <p className="mt-4 font-serif text-xl text-[var(--things-amber)]">
          {ejected.name} was the {LIARS_ROLES[ejected.role].name}
        </p>
      ) : null}
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
        <p className="mt-4 font-serif text-lg text-white/65">
          They have thirty seconds to name the word. If they get it, they take the whole game.
        </p>
        <PhaseTimer endsAt={snapshot.phaseEndsAt} clockOffset={clockOffset} label="they have" />
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

      <ul className="mt-8 border-t border-white/10">
        {ending.roles.map(({ playerId, name, role }) => (
          <li
            key={playerId}
            className="flex min-h-12 items-center gap-3 border-b border-white/10"
          >
            <span className="font-serif text-lg">{name}</span>
            <span className="ml-auto font-mono text-xs uppercase tracking-[0.14em] text-white/55">
              {LIARS_ROLES[role].name}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <Eyebrow>what happened</Eyebrow>
        <ol className="mt-3 space-y-2 font-mono text-xs leading-relaxed text-white/50">
          {ending.log.map((entry, index) => (
            <li key={index}>
              <span className="text-white/30">
                {entry.phase} {entry.round}
              </span>{" "}
              {entry.text}
            </li>
          ))}
        </ol>
      </div>

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
function Graveyard({
  snapshot,
  send,
}: {
  snapshot: LiarsSnapshot;
  send: PhaseProps["send"];
}) {
  const graveyard = snapshot.graveyard;
  if (!graveyard) return null;
  const living = snapshot.players.filter(({ alive }) => alive);
  const armsAt = liarsGraveyardArmsAt(snapshot.players.length);

  return (
    <section className="mt-10 border-t border-white/10 pt-5" aria-label="the graveyard">
      <Eyebrow>the graveyard</Eyebrow>
      <p className="mt-2 font-mono text-xs text-white/45">
        {graveyard.armed
          ? "your vote counts as one more ballot"
          : `the graveyard votes when ${armsAt} are gone · ${graveyard.deadCount} so far`}
      </p>
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
                    graveyard.yourVote === player.id
                      ? "bg-[var(--things-amber)]"
                      : "bg-transparent"
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
    </section>
  );
}
