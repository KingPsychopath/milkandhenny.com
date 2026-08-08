import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameShell } from "../shared/GameShell";
import {
  readExpiringLocalValue,
  removeStorageKeys,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { useWakeLock } from "@/hooks/useWakeLock";
import { JoinSameBrainRoom } from "./JoinSameBrainRoom";
import { sameBrainBrowserKeys } from "./same-brain-keys";
import {
  applySameBrainHostActionFn,
  applySameBrainPlayerActionFn,
} from "./same-brain-room.functions";
import {
  SAME_BRAIN_MAX_ANSWER_LENGTH,
  SAME_BRAIN_PLAYER_LIMITS,
  SAME_BRAIN_ROUND_LIMITS,
  SAME_BRAIN_SAY_IT_HOLD_MS,
} from "./same-brain-rules";
import {
  ActionButton,
  Eyebrow,
  Headline,
  InvitePanel,
  PhaseTimer,
  RevealBoard,
  SayItBeat,
  Scoreboard,
} from "./SameBrainViews";
import { buildSameBrainPlayerInviteUrl } from "./same-brain-invite";
import { useSameBrainRoom } from "./useSameBrainRoom";
import type { SameBrainPlayerCredentials, SameBrainScoring, SameBrainSnapshot } from "./types";

let actionCounter = 0;
const nextActionId = () => `sb-${Date.now().toString(36)}-${(actionCounter += 1)}`;

export function SameBrainRoomApp({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<SameBrainPlayerCredentials | null>(() => {
    if (typeof window === "undefined") return null;
    return readExpiringLocalValue<SameBrainPlayerCredentials>(
      sameBrainBrowserKeys.playerSession(roomId),
    );
  });

  if (!credentials)
    return (
      <JoinSameBrainRoom
        roomId={roomId}
        onJoined={(joined) => {
          writeExpiringLocalValue(
            sameBrainBrowserKeys.playerSession(roomId),
            joined,
            joined.expiresAt,
          );
          setCredentials(joined);
        }}
      />
    );

  return <SameBrainRoom key={credentials.playerId} credentials={credentials} />;
}

/**
 * The whole player surface, given credentials directly. Exported so the dev harness can mount a
 * table's worth of them side by side and be looking at exactly what a player looks at, rather than
 * at a debug view that drifts from the real thing.
 */
export function SameBrainRoom({ credentials }: { credentials: SameBrainPlayerCredentials }) {
  const { roomId, playerId, playerToken } = credentials;
  const room = useSameBrainRoom({
    roomId,
    playerId,
    playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const snapshot = room.snapshot;
  useWakeLock(Boolean(snapshot) && snapshot?.phase !== "lobby");

  const busyRef = useRef(false);
  const send = useCallback(
    async (action: Record<string, unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await applySameBrainPlayerActionFn({
          data: {
            roomId,
            playerId,
            playerToken,
            action: { actionId: nextActionId(), ...action },
          },
        });
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
        // Everyone else is waiting on a poll to learn the round moved on.
        if (result.accepted) room.notify();
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
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await applySameBrainHostActionFn({
          data: {
            roomId,
            playerId,
            playerToken,
            action: { actionId: nextActionId(), ...action },
          },
        });
        if (result.snapshot) room.setSnapshot(result.snapshot);
        if (!result.accepted && "error" in result) room.setMessage(result.error);
        if (result.accepted) room.notify();
      } catch {
        room.setMessage("That did not go through. Try again.");
      } finally {
        busyRef.current = false;
      }
    },
    [playerId, playerToken, room, roomId],
  );

  /**
   * The room is gone: expired, closed by the host, or answering every read with an error.
   *
   * Without this the poll loop stops and the player keeps looking at the last snapshot it managed to
   * fetch — a live-looking question with a countdown frozen at 00:00 and a button that does nothing.
   * Saying so plainly is better, and the stored credentials go with it: they belong to a room that no
   * longer exists, so keeping them would make the door unopenable next time rather than offering a
   * fresh join.
   */
  if (room.ended)
    return (
      <GameShell tone="night">
        <div className="flex min-h-svh items-center justify-center px-6 text-center text-white">
          <div>
            <h1 className="font-serif text-4xl font-semibold">The room has gone quiet.</h1>
            <p className="mt-4 font-serif text-lg text-white/60">
              {room.message ?? "This room is no longer available."}
            </p>
            <Link
              to="/things/same-brain"
              onClick={() =>
                removeStorageKeys(localStorage, [sameBrainBrowserKeys.playerSession(roomId)])
              }
              className="mt-7 inline-flex min-h-12 items-center rounded-full border border-white/25 px-6 font-mono text-xs text-white/80"
            >
              back to same brain
            </Link>
          </div>
        </div>
      </GameShell>
    );

  if (!snapshot)
    return (
      <GameShell tone="night">
        <div className="flex min-h-svh items-center justify-center text-white/50">
          <p className="font-mono text-xs">joining…</p>
        </div>
      </GameShell>
    );

  const isHost = snapshot.hostPlayerId === playerId;

  return (
    <GameShell tone="night">
      <div className="flex min-h-svh flex-col text-white">
        <header className="mx-auto flex w-full max-w-lg items-center gap-3 px-5 pt-4 font-mono text-micro uppercase tracking-[0.16em] text-white/35">
          <span>{snapshot.roomId}</span>
          {snapshot.phase !== "lobby" && snapshot.phase !== "ending" ? (
            <span>
              round {snapshot.round} of {snapshot.rounds}
            </span>
          ) : null}
          <span className="ml-auto">
            {room.connectionState === "connected" ? "" : room.connectionState}
          </span>
        </header>

        <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-24 pt-6">
          {snapshot.phase === "lobby" ? (
            <LobbyPhase snapshot={snapshot} isHost={isHost} send={send} sendHost={sendHost} />
          ) : null}
          {snapshot.phase === "prompt" ? (
            <PromptPhase snapshot={snapshot} clockOffset={room.clockOffset} />
          ) : null}
          {snapshot.phase === "submit" ? (
            <SubmitPhase
              snapshot={snapshot}
              clockOffset={room.clockOffset}
              send={send}
              isHost={isHost}
              sendHost={sendHost}
            />
          ) : null}
          {snapshot.phase === "sayIt" ? (
            <SayItPhase snapshot={snapshot} clockOffset={room.clockOffset} />
          ) : null}
          {snapshot.phase === "reveal" ? (
            <RevealPhase
              snapshot={snapshot}
              clockOffset={room.clockOffset}
              isHost={isHost}
              sendHost={sendHost}
            />
          ) : null}
          {snapshot.phase === "ending" ? (
            <EndingPhase snapshot={snapshot} isHost={isHost} sendHost={sendHost} />
          ) : null}

          {room.message ? (
            <p className="mt-6 font-mono text-xs text-[var(--things-amber)]" role="status">
              {room.message}
            </p>
          ) : null}
        </main>
      </div>
    </GameShell>
  );
}

type Send = (action: Record<string, unknown>) => Promise<void>;

function LobbyPhase({
  snapshot,
  isHost,
  send,
  sendHost,
}: {
  snapshot: SameBrainSnapshot;
  isHost: boolean;
  send: Send;
  sendHost: Send;
}) {
  const enough = snapshot.players.length >= SAME_BRAIN_PLAYER_LIMITS.min;
  const inviteUrl =
    typeof window === "undefined"
      ? ""
      : buildSameBrainPlayerInviteUrl(
          window.location.origin,
          snapshot.roomId,
          readExpiringLocalValue<string>(sameBrainBrowserKeys.invite(snapshot.roomId)) ?? undefined,
        );

  return (
    <>
      <Eyebrow>same brain</Eyebrow>
      <Headline>Everyone answers. Whoever agrees, scores.</Headline>
      <p className="mt-4 font-mono text-xs leading-relaxed text-white/50">
        A question goes to every phone. Type one answer. The biggest group that said the same thing
        takes the points — and if all of you say it, it is worth half, so the obvious answer is the
        cheap one.
      </p>

      <div className="mt-8">
        <InvitePanel roomId={snapshot.roomId} inviteUrl={inviteUrl} />
      </div>

      <div className="mt-8">
        <Eyebrow>who is here · {snapshot.players.length}</Eyebrow>
      </div>
      <Scoreboard snapshot={snapshot} />

      {isHost ? (
        <section className="mt-8 border-t border-white/15 pt-5">
          <Eyebrow>house rules</Eyebrow>
          <label className="mt-4 flex min-h-11 items-center gap-3 font-mono text-xs text-white/60">
            rounds
            <input
              type="number"
              min={SAME_BRAIN_ROUND_LIMITS.min}
              max={SAME_BRAIN_ROUND_LIMITS.max}
              value={snapshot.rounds}
              onChange={(event) =>
                void sendHost({ type: "game.configure", rounds: Number(event.target.value) })
              }
              className="w-16 border border-white/20 bg-transparent px-2 py-1 text-white"
            />
          </label>

          <fieldset className="mt-4">
            <legend className="font-mono text-xs text-white/60">
              when two answers nearly match
            </legend>
            {(
              [
                ["embedding", "count them as one", "sea and ocean score together"],
                ["exact", "keep them apart", "only identical answers score together"],
              ] as Array<[SameBrainScoring, string, string]>
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className="mt-2 flex min-h-11 items-start gap-3 font-mono text-xs text-white/70"
              >
                <input
                  type="radio"
                  name="scoring"
                  checked={snapshot.scoring === value}
                  onChange={() => void sendHost({ type: "game.configure", scoring: value })}
                  className="mt-1"
                />
                <span>
                  {label}
                  <span className="block text-white/35">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Toggle
            label="say the answers out loud"
            hint="counts everyone down, then shows you your own word — for a room, not a call"
            checked={snapshot.toggles.sayItAloud}
            onChange={(next) =>
              void sendHost({ type: "game.configure", toggles: { sayItAloud: next } })
            }
          />
          <Toggle
            label="the odd one out is eliminated"
            hint="off, the loner just misses out; on, they leave the game"
            checked={snapshot.toggles.eliminateOddOne}
            onChange={(next) =>
              void sendHost({ type: "game.configure", toggles: { eliminateOddOne: next } })
            }
          />
          <Toggle
            label="show who wrote what"
            hint="off makes the reveal anonymous and the argument louder"
            checked={snapshot.toggles.revealAuthors}
            onChange={(next) =>
              void sendHost({ type: "game.configure", toggles: { revealAuthors: next } })
            }
          />
          <Toggle
            label="say when the machine merged answers"
            hint="so you can overrule it out loud"
            checked={snapshot.toggles.showMachineWorking}
            onChange={(next) =>
              void sendHost({ type: "game.configure", toggles: { showMachineWorking: next } })
            }
          />

          <div className="mt-8">
            <ActionButton onClick={() => void sendHost({ type: "game.start" })} disabled={!enough}>
              {enough ? "start" : `${SAME_BRAIN_PLAYER_LIMITS.min} people is the smallest game`}
            </ActionButton>
          </div>
        </section>
      ) : (
        <p className="mt-8 font-mono text-xs text-white/40">
          waiting for {snapshot.players.find(({ host }) => host)?.name ?? "the host"} to start
        </p>
      )}

      {!snapshot.you?.id ? null : (
        <div className="mt-6">
          <ActionButton
            tone="quiet"
            onClick={() =>
              void send({
                type: "readiness.set",
                ready: !snapshot.players.find(({ id }) => id === snapshot.you?.id)?.ready,
              })
            }
          >
            {snapshot.players.find(({ id }) => id === snapshot.you?.id)?.ready
              ? "step away for a minute"
              : "I'm back"}
          </ActionButton>
        </div>
      )}
    </>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="mt-4 flex min-h-11 items-start gap-3 font-mono text-xs text-white/70">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        {label}
        <span className="block text-white/35">{hint}</span>
      </span>
    </label>
  );
}

/** A beat with the question and nothing to do, so nobody is typing before they have read it. */
function PromptPhase({
  snapshot,
  clockOffset,
}: {
  snapshot: SameBrainSnapshot;
  clockOffset: number;
}) {
  return (
    <>
      <Eyebrow>round {snapshot.round}</Eyebrow>
      <Headline>{snapshot.question}</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label="think"
        paused={snapshot.paused}
      />
    </>
  );
}

function SubmitPhase({
  snapshot,
  clockOffset,
  send,
  isHost,
  sendHost,
}: {
  snapshot: SameBrainSnapshot;
  clockOffset: number;
  send: Send;
  isHost: boolean;
  sendHost: Send;
}) {
  const [draft, setDraft] = useState("");
  const answered = snapshot.you?.answer ?? null;
  const waiting = snapshot.players.filter(({ out, answered: done }) => !out && !done);

  // A reconnect mid-round arrives with the answer already on the server; show that, not an empty box.
  useEffect(() => {
    if (answered) setDraft(answered);
  }, [answered]);

  if (snapshot.you?.out)
    return (
      <>
        <Eyebrow>round {snapshot.round}</Eyebrow>
        <Headline>{snapshot.question}</Headline>
        <p className="mt-6 font-mono text-xs text-white/45">
          You are out of this game — watch the rest of it happen.
        </p>
        <Scoreboard snapshot={snapshot} />
      </>
    );

  return (
    <>
      <Eyebrow>round {snapshot.round}</Eyebrow>
      <Headline>{snapshot.question}</Headline>
      <PhaseTimer
        endsAt={snapshot.phaseEndsAt}
        clockOffset={clockOffset}
        label="answer"
        big
        paused={snapshot.paused}
      />

      {answered ? (
        <div className="mt-8">
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">you said</p>
          <p className="mt-2 font-serif text-4xl text-[var(--things-amber)]">{answered}</p>
          <div className="mt-6">
            <ActionButton
              tone="quiet"
              onClick={() => void send({ type: "answer.clear", round: snapshot.round })}
            >
              change it
            </ActionButton>
          </div>
        </div>
      ) : (
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim())
              void send({ type: "answer.submit", round: snapshot.round, text: draft.trim() });
          }}
        >
          <label className="block font-mono text-xs text-white/55">
            <span className="block pb-2">your answer</span>
            <input
              value={draft}
              maxLength={SAME_BRAIN_MAX_ANSWER_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              // Autocorrect quietly rewriting an answer would look like the game misreading it.
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-14 w-full border-b border-white/25 bg-transparent font-serif text-3xl text-white outline-none focus-visible:border-[var(--things-amber)]"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="mt-8 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black disabled:opacity-40"
          >
            lock it in
          </button>
        </form>
      )}

      <p className="mt-8 font-mono text-xs text-white/35">
        {waiting.length === 0
          ? "everyone has answered"
          : `waiting on ${waiting.map(({ name }) => name).join(", ")}`}
      </p>

      {isHost ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionButton tone="quiet" onClick={() => void sendHost({ type: "phase.advance" })}>
            score it now
          </ActionButton>
          <ActionButton tone="quiet" onClick={() => void sendHost({ type: "game.skipQuestion" })}>
            different question
          </ActionButton>
          <ActionButton
            tone="quiet"
            onClick={() =>
              void sendHost({ type: snapshot.paused ? "phase.resume" : "phase.pause" })
            }
          >
            {snapshot.paused ? "carry on" : "hold on"}
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

function SayItPhase({
  snapshot,
  clockOffset,
}: {
  snapshot: SameBrainSnapshot;
  clockOffset: number;
}) {
  return (
    <>
      <Eyebrow>round {snapshot.round}</Eyebrow>
      <p className="mt-2 font-serif text-2xl text-white/60">{snapshot.question}</p>
      <SayItBeat
        endsAt={snapshot.phaseEndsAt}
        holdMs={SAME_BRAIN_SAY_IT_HOLD_MS}
        clockOffset={clockOffset}
        word={snapshot.you?.answer ?? null}
      />
    </>
  );
}

function RevealPhase({
  snapshot,
  clockOffset,
  isHost,
  sendHost,
}: {
  snapshot: SameBrainSnapshot;
  clockOffset: number;
  isHost: boolean;
  sendHost: Send;
}) {
  const result = snapshot.result;
  if (!result)
    return (
      <>
        <Eyebrow>round {snapshot.round}</Eyebrow>
        <Headline>Counting…</Headline>
      </>
    );

  const herdIds = result.herdIndex === null ? [] : result.clusters[result.herdIndex].playerIds;

  return (
    <>
      <Eyebrow>round {snapshot.round}</Eyebrow>
      <p className="mt-2 font-serif text-2xl text-white/60">{result.question}</p>
      <RevealBoard
        result={result}
        snapshot={snapshot}
        onMerge={
          isHost
            ? (from, to) => void sendHost({ type: "result.merge", round: snapshot.round, from, to })
            : undefined
        }
      />
      {isHost && result.corrected ? (
        <div className="mt-3">
          <ActionButton
            tone="quiet"
            onClick={() => void sendHost({ type: "result.reset", round: snapshot.round })}
          >
            put it back how it was
          </ActionButton>
        </div>
      ) : null}
      <div className="mt-8 border-t border-white/15 pt-4">
        <Eyebrow>scores</Eyebrow>
        <Scoreboard snapshot={snapshot} highlightIds={herdIds} />
      </div>
      <div className="mt-6">
        <PhaseTimer
          endsAt={snapshot.phaseEndsAt}
          clockOffset={clockOffset}
          label="next round"
          paused={snapshot.paused}
        />
      </div>
      {isHost ? (
        <div className="mt-4">
          <ActionButton tone="quiet" onClick={() => void sendHost({ type: "phase.advance" })}>
            {snapshot.round >= snapshot.rounds ? "final scores" : "next round"}
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

function EndingPhase({
  snapshot,
  isHost,
  sendHost,
}: {
  snapshot: SameBrainSnapshot;
  isHost: boolean;
  sendHost: Send;
}) {
  const winners = snapshot.players.filter(({ id }) => snapshot.winnerIds.includes(id));
  return (
    <>
      <Eyebrow>that is the game</Eyebrow>
      <Headline>
        {winners.length === 0
          ? "Nobody scored a thing."
          : winners.length === 1
            ? `${winners[0].name} thinks like everybody else.`
            : `${winners.map(({ name }) => name).join(" and ")} tie.`}
      </Headline>
      <Scoreboard snapshot={snapshot} highlightIds={snapshot.winnerIds} />

      {snapshot.history.length > 0 ? (
        <section className="mt-8 border-t border-white/15 pt-4">
          <Eyebrow>every round</Eyebrow>
          <ul className="mt-3">
            {snapshot.history.map((round) => (
              <li key={round.round} className="border-t border-white/10 py-2 font-mono text-xs">
                <p className="text-white/45">{round.question}</p>
                <p className="mt-1 text-white/70">
                  {round.herdIndex === null
                    ? "no herd"
                    : `${round.clusters[round.herdIndex].label} · ${round.clusters[round.herdIndex].playerIds.length} of you`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isHost ? (
        <div className="mt-8 flex flex-col gap-3">
          <ActionButton onClick={() => void sendHost({ type: "game.replay" })}>again</ActionButton>
          <ActionButton tone="quiet" onClick={() => void sendHost({ type: "game.lobby" })}>
            back to the lobby
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}
