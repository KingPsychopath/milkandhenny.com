import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import {
  applyPlayerActionFn,
  applyPresenterActionFn,
  closePartyRoomFn,
  joinPartyRoomFn,
} from "./party-room.functions";
import type {
  PartyClueKind,
  PartyPlayerAction,
  PartyPlayerCredentials,
  PartyPresenterAction,
} from "./types";
import { usePartyLiveSnapshot } from "./usePartyLiveSnapshot";
import { useSynchronizedPartyStage } from "./useSynchronizedPartyStage";
import { PartyClosenessBoard } from "./PartyClosenessBoard";
import { PartyRoundCooldown } from "./PartyRoundCooldown";
import { partyBrowserKeys } from "./party-keys";
import { EndGameDialog } from "../shared/EndGameDialog";
import { GameActionDialog } from "../shared/GameActionDialog";
import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  removeStorageKeys,
  removeStoragePrefix,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { playPartySpeech, unlockPartyAudio } from "./party-audio.client";
import { shareOrCopy } from "@/lib/client/share";
import { useQrCode } from "@/hooks/useQrCode";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { buildPartyPlayerInviteUrl, parsePartyPlayerFragment } from "./party-invite";

function joinToken(roomId: string) {
  const key = partyBrowserKeys.invite(roomId);
  const fromHash = parsePartyPlayerFragment(consumeLocationFragment());
  if (fromHash) {
    sessionStorage.setItem(key, fromHash);
    return fromHash;
  }
  const current = sessionStorage.getItem(key);
  if (current) return current;
  return "";
}
function playerKey(roomId: string) {
  return partyBrowserKeys.playerSession(roomId);
}
function readPlayer(roomId: string): PartyPlayerCredentials | null {
  const current = readExpiringLocalValue<PartyPlayerCredentials>(playerKey(roomId));
  if (
    current?.roomId === roomId &&
    typeof current.playerId === "string" &&
    typeof current.playerToken === "string"
  )
    return current;
  return null;
}

export function PartyPlayerApp({ roomId }: { roomId: string }) {
  const [invite, setInvite] = useState("");
  const [credentials, setCredentials] = useState<PartyPlayerCredentials | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const joinId = useRef<string | null>(null);
  if (joinId.current === null) joinId.current = crypto.randomUUID();
  useEffect(() => {
    clearExpiredGameLocalStorage();
    setInvite(joinToken(roomId));
    setCredentials(readPlayer(roomId));
  }, [roomId]);
  const handleJoin = async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinPartyRoomFn({
        data: { roomId, joinToken: invite || undefined, name, joinId: joinId.current },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        return;
      }
      writeExpiringLocalValue(playerKey(roomId), result, result.expiresAt);
      setCredentials(result);
    } catch {
      setMessage("Could not join. Check your connection and try again.");
      setJoining(false);
    }
  };
  if (credentials) return <PartyPlayerGame credentials={credentials} />;
  return (
    <main
      id="main"
      className="things-game things-game--night flex items-center justify-center px-6 text-white"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleJoin();
        }}
        className="w-full max-w-sm text-center"
      >
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
          room {roomId}
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">What should we call you?</h1>
        <label htmlFor="party-name" className="sr-only">
          Your display name
        </label>
        <input
          id="party-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={24}
          autoComplete="name"
          enterKeyHint="go"
          placeholder="Your name"
          className="mt-7 min-h-14 w-full rounded-full border border-white/20 bg-white/[0.06] px-5 text-center font-serif text-xl placeholder:text-white/30"
        />
        <button
          type="submit"
          disabled={!name.trim() || joining}
          className="mt-4 min-h-14 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-35"
        >
          {joining ? "joining…" : "join the room"}
        </button>
        <p aria-live="polite" className="mt-4 min-h-5 font-mono text-xs text-amber-200">
          {message}
        </p>
      </form>
    </main>
  );
}

function PartyPlayerGame({ credentials }: { credentials: PartyPlayerCredentials }) {
  const navigate = useNavigate();
  const isHost = Boolean(credentials.presenterToken);
  const live = usePartyLiveSnapshot({
    roomId: credentials.roomId,
    role: "player",
    credential: credentials.playerToken,
    playerId: credentials.playerId,
    presenterToken: credentials.presenterToken,
    initialSnapshot: credentials.snapshot,
  });
  useUpdateReloadSafety(
    "spelling-party-player",
    live.snapshot?.phase === "lobby" || live.snapshot?.phase === "finished",
  );
  const stage = useSynchronizedPartyStage(live.snapshot, live.clockOffset);
  const [draft, setDraft] = useState(credentials.snapshot.player?.draft ?? "");
  const draftRevision = useRef(credentials.snapshot.player?.draftRevision ?? 0);
  const roundRef = useRef(credentials.snapshot.round?.roundId ?? "");
  const hiddenAt = useRef<number | null>(null);
  const priorLocked = useRef(false);
  const priorPhase = useRef(live.snapshot?.phase);
  const playedAudio = useRef(new Set<string>());
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [sentenceClueConfirmationOpen, setSentenceClueConfirmationOpen] = useState(false);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [requestingSentenceClue, setRequestingSentenceClue] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const haptics = useWebHaptics();
  const previousStartRequest = useRef<string | null>(null);
  const queueKey = partyBrowserKeys.pendingActions(credentials.roomId, credentials.playerId);

  const queued = useCallback((): PartyPlayerAction[] => {
    return readExpiringLocalValue<PartyPlayerAction[]>(queueKey) ?? [];
  }, [queueKey]);
  const enqueue = useCallback(
    (action: PartyPlayerAction) => {
      const next = [
        ...queued().filter(({ actionId }) => actionId !== action.actionId),
        action,
      ].slice(-40);
      writeExpiringLocalValue(queueKey, next, credentials.expiresAt);
    },
    [credentials.expiresAt, queueKey, queued],
  );

  const send = useCallback(
    async (action: PartyPlayerAction, buffer = true) => {
      try {
        const result = await applyPlayerActionFn({
          data: {
            roomId: credentials.roomId,
            playerId: credentials.playerId,
            playerToken: credentials.playerToken,
            action,
          },
        });
        if (result.snapshot && !isHost) live.setSnapshot(result.snapshot);
        if (!result.accepted) {
          live.setMessage(result.error ?? "That action is no longer available.");
          return false;
        }
        const remaining = queued().filter(({ actionId }) => actionId !== action.actionId);
        if (remaining.length) writeExpiringLocalValue(queueKey, remaining, credentials.expiresAt);
        else localStorage.removeItem(queueKey);
        live.notify();
        live.setMessage(null);
        if (isHost) await live.refresh();
        return true;
      } catch {
        if (buffer) enqueue(action);
        live.setMessage("Saved on this phone. Reconnecting…");
        return false;
      }
    },
    [
      credentials.expiresAt,
      credentials.playerId,
      credentials.playerToken,
      credentials.roomId,
      enqueue,
      isHost,
      live,
      queueKey,
      queued,
    ],
  );

  const flush = useCallback(async () => {
    for (const action of queued()) {
      const ok = await send(action, false);
      if (!ok) break;
    }
  }, [queued, send]);
  useEffect(() => {
    if (live.connectionState === "connected") void flush();
  }, [flush, live.connectionState]);

  const snapshot = live.snapshot;
  const setLiveMessage = live.setMessage;
  const round = snapshot?.round;
  const player = snapshot?.player;
  const recoveredHost = isHost
    ? readExpiringLocalValue<{ joinToken?: string }>(
        partyBrowserKeys.presenterRecovery(credentials.roomId),
      )
    : null;
  const hostJoinToken =
    typeof window !== "undefined"
      ? (sessionStorage.getItem(partyBrowserKeys.invite(credentials.roomId)) ??
        recoveredHost?.joinToken)
      : null;
  const hostInvite =
    isHost && hostJoinToken
      ? buildPartyPlayerInviteUrl(location.origin, credentials.roomId, hostJoinToken)
      : null;

  useEffect(() => {
    const requestId = player?.startRequestId ?? null;
    if (!requestId || requestId === previousStartRequest.current) return;
    previousStartRequest.current = requestId;
    setLiveMessage("The host is ready to start — tap Ready when you are.");
    void haptics.trigger("heavy");
  }, [haptics, player?.startRequestId, setLiveMessage]);

  useEffect(() => {
    if (!isHost || !round || snapshot?.phase !== "countdown") return;
    const audio = round.wordAudioUrl ? new Audio(round.wordAudioUrl) : null;
    if (audio) {
      audio.preload = "auto";
      audio.load();
    }
    const delay = Math.max(0, round.audioPlaysAt - (Date.now() + live.clockOffset));
    const timer = window.setTimeout(() => {
      if (playedAudio.current.has(`word:${round.roundId}`)) return;
      playedAudio.current.add(`word:${round.roundId}`);
      void playPartySpeech(round.wordAudioUrl, round.spokenWord, round.speechLocale).then(
        (played) => {
          if (!played) setLiveMessage("Tap ‘play word again’—this phone blocked automatic audio.");
        },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isHost, live.clockOffset, round, setLiveMessage, snapshot?.phase]);

  useEffect(() => {
    if (!isHost) return;
    const clue = round?.activeClue;
    if (!clue || playedAudio.current.has(`clue:${clue.id}`)) return;
    playedAudio.current.add(`clue:${clue.id}`);
    void playPartySpeech(clue.audioUrl, clue.speechText, round?.speechLocale).then((played) => {
      if (!played) setLiveMessage("Tap the clue notice to play it.");
    });
  }, [isHost, round?.activeClue, round?.speechLocale, setLiveMessage]);
  useEffect(() => {
    if (!round || !player) return;
    const key = partyBrowserKeys.draft(credentials.roomId, round.roundId);
    if (roundRef.current !== round.roundId) {
      if (roundRef.current)
        localStorage.removeItem(partyBrowserKeys.draft(credentials.roomId, roundRef.current));
      roundRef.current = round.roundId;
      const local = readExpiringLocalValue<{ draft: string; revision: number }>(key);
      if (local && local.revision > player.draftRevision) {
        setDraft(local.draft);
        draftRevision.current = local.revision;
      } else {
        setDraft(player.draft);
        draftRevision.current = player.draftRevision;
      }
    } else if (player.draftRevision > draftRevision.current) {
      setDraft(player.draft);
      draftRevision.current = player.draftRevision;
    }
  }, [credentials.roomId, player, round]);

  useEffect(() => {
    if (!round || snapshot?.phase !== "answer" || player?.locked) return;
    const key = partyBrowserKeys.draft(credentials.roomId, round.roundId);
    writeExpiringLocalValue(key, { draft, revision: draftRevision.current }, credentials.expiresAt);
    const action: PartyPlayerAction = {
      actionId: `${credentials.playerId}:${round.roundId}:draft:${draftRevision.current}`,
      type: "draft.update",
      roundId: round.roundId,
      draft,
      draftRevision: draftRevision.current,
    };
    const timer = window.setTimeout(() => void send(action), 140);
    return () => window.clearTimeout(timer);
  }, [
    credentials.expiresAt,
    credentials.playerId,
    credentials.roomId,
    draft,
    player?.locked,
    round,
    send,
    snapshot?.phase,
  ]);

  const canType = snapshot?.phase === "answer" && !player?.locked;
  const addLetter = useCallback(
    (letter: string) => {
      if (!canType) return;
      setDraft((current) => (current.length >= 32 ? current : `${current}${letter}`));
      draftRevision.current += 1;
      void haptics.trigger("selection");
    },
    [canType, haptics],
  );
  const backspace = useCallback(() => {
    if (!canType) return;
    setDraft((current) => current.slice(0, -1));
    draftRevision.current += 1;
    void haptics.trigger("nudge");
  }, [canType, haptics]);
  const lock = useCallback(async () => {
    if (!round || !canType) return;
    const update: PartyPlayerAction = {
      actionId: `${credentials.playerId}:${round.roundId}:draft:${draftRevision.current}`,
      type: "draft.update",
      roundId: round.roundId,
      draft,
      draftRevision: draftRevision.current,
    };
    await send(update);
    const accepted = await send({
      actionId: crypto.randomUUID(),
      type: "answer.lock",
      roundId: round.roundId,
    });
    if (accepted) void haptics.trigger("success");
  }, [canType, credentials.playerId, draft, haptics, round, send]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (endConfirmationOpen || sentenceClueConfirmationOpen) return;
      if (/^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        addLetter(event.key.toLocaleUpperCase());
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void lock();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [addLetter, backspace, endConfirmationOpen, lock, sentenceClueConfirmationOpen]);

  const sendClueRequest = async (clue: PartyClueKind) => {
    if (!round) return;
    await send({
      actionId: crypto.randomUUID(),
      type: "clue.request",
      roundId: round.roundId,
      clue,
    });
  };
  const requestClue = (clue: PartyClueKind) => {
    if (clue === "sentence") {
      setSentenceClueConfirmationOpen(true);
      return;
    }
    void sendClueRequest(clue);
  };
  const confirmSentenceClue = async () => {
    setRequestingSentenceClue(true);
    try {
      await sendClueRequest("sentence");
      setSentenceClueConfirmationOpen(false);
    } finally {
      setRequestingSentenceClue(false);
    }
  };

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && snapshot?.phase === "answer") hiddenAt.current = Date.now();
      else if (!document.hidden && hiddenAt.current && round) {
        const hiddenMs = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (hiddenMs >= 1_000)
          void send({
            actionId: crypto.randomUUID(),
            type: "integrity.notice",
            roundId: round.roundId,
            hiddenMs,
          });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [round, send, snapshot?.phase]);

  useEffect(() => {
    if (player?.locked && !priorLocked.current)
      void haptics.trigger(player.lockedAutomatically ? "selection" : "success");
    priorLocked.current = player?.locked ?? false;
    if (snapshot?.phase === "reveal" && priorPhase.current !== "reveal") {
      const answer = round?.answers?.find(({ playerId }) => playerId === credentials.playerId);
      void haptics.trigger(answer?.correct ? "success" : "nudge");
    }
    if (snapshot?.phase === "answer" && priorPhase.current !== "answer")
      void haptics.trigger("selection");
    if (snapshot?.phase === "finished" && priorPhase.current !== "finished")
      void haptics.trigger("success");
    priorPhase.current = snapshot?.phase;
  }, [
    credentials.playerId,
    haptics,
    player?.locked,
    player?.lockedAutomatically,
    round?.answers,
    snapshot?.phase,
  ]);

  const previousTick = useRef("");
  useEffect(() => {
    if (/^[123]$/.test(stage.label) && stage.label !== previousTick.current)
      void haptics.trigger("selection");
    previousTick.current = stage.label;
  }, [haptics, stage.label]);

  useEffect(() => {
    if (snapshot?.phase !== "finished") return;
    localStorage.removeItem(queueKey);
    removeStoragePrefix(localStorage, partyBrowserKeys.draftPrefix(credentials.roomId));
    writeExpiringLocalValue(
      playerKey(credentials.roomId),
      credentials,
      Math.min(credentials.expiresAt, Date.now() + 15 * 60_000),
    );
  }, [credentials, queueKey, snapshot?.phase]);

  useEffect(() => {
    if (!live.ended) return;
    sessionStorage.removeItem(partyBrowserKeys.invite(credentials.roomId));
    removeStorageKeys(localStorage, [playerKey(credentials.roomId), queueKey]);
    removeStoragePrefix(localStorage, partyBrowserKeys.draftPrefix(credentials.roomId));
  }, [credentials.playerId, credentials.roomId, live.ended, queueKey]);

  const setReady = async (ready: boolean) => {
    const accepted = await send({
      actionId: crypto.randomUUID(),
      type: "readiness.set",
      ready,
    });
    if (accepted) void haptics.trigger("selection");
  };

  const sendHostAction = async (type: PartyPresenterAction["type"], removePlayerIds?: string[]) => {
    if (!credentials.presenterToken) return;
    unlockPartyAudio();
    try {
      const result = await applyPresenterActionFn({
        data: {
          roomId: credentials.roomId,
          presenterToken: credentials.presenterToken,
          action:
            type === "round.start"
              ? { actionId: crypto.randomUUID(), type, removePlayerIds }
              : { actionId: crypto.randomUUID(), type },
        },
      });
      if (!result.accepted) {
        live.setMessage(result.error ?? "That action is not ready yet.");
        if (result.errorCode === "players_not_ready" && result.snapshot) {
          const removable = result.snapshot.players.filter(
            ({ id, ready }) => !ready && id !== credentials.playerId,
          );
          if (result.snapshot.player?.ready && removable.length > 0)
            setRemovePlayerIds(removable.map(({ id }) => id));
        }
        live.notify();
        return;
      }
      setRemovePlayerIds(null);
      live.notify();
      await live.refresh();
    } catch {
      live.setMessage("Reconnecting… Try that once more.");
    }
  };

  const confirmStart = async () => {
    if (!removePlayerIds) return;
    setConfirmingStart(true);
    try {
      await sendHostAction("round.start", removePlayerIds);
    } finally {
      setConfirmingStart(false);
    }
  };

  const replayHostAudio = () => {
    if (round)
      void playPartySpeech(round.wordAudioUrl, round.spokenWord, round.speechLocale).then(
        (played) => {
          if (!played) live.setMessage("Audio could not play on this phone.");
        },
      );
  };

  const handleLeave = async () => {
    setLeaving(true);
    if (isHost && credentials.presenterToken)
      await closePartyRoomFn({
        data: { roomId: credentials.roomId, presenterToken: credentials.presenterToken },
      }).catch(() => null);
    sessionStorage.removeItem(partyBrowserKeys.invite(credentials.roomId));
    removeStorageKeys(localStorage, [playerKey(credentials.roomId), queueKey]);
    removeStoragePrefix(localStorage, partyBrowserKeys.draftPrefix(credentials.roomId));
    removeStorageKeys(localStorage, [partyBrowserKeys.presenterRecovery(credentials.roomId)]);
    await navigate({ to: "/things/spelling-party" });
  };

  const leaderboard = useMemo(
    () =>
      [...(snapshot?.players ?? [])].sort(
        (a, b) => b.score - a.score || a.name.localeCompare(b.name),
      ),
    [snapshot?.players],
  );
  if (live.ended)
    return (
      <main
        id="main"
        className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"
      >
        <div>
          <h1 className="font-serif text-5xl font-semibold">Party ended.</h1>
          <p className="mt-4 font-serif text-lg text-white/60">This room has been cleared.</p>
          <button
            type="button"
            onClick={() => void handleLeave()}
            className="mt-6 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm"
          >
            back to spelling bee
          </button>
        </div>
      </main>
    );
  if (!snapshot)
    return <PlayerMessage title="Rejoining…" detail={live.message ?? "Your place is saved."} />;
  const ownReveal = round?.answers?.find(({ playerId }) => playerId === credentials.playerId);
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55">
        <button type="button" onClick={() => setEndConfirmationOpen(true)} className="min-h-11">
          {isHost ? "end party" : "leave game"}
        </button>
        <span aria-live="polite">
          {live.connectionState === "connected"
            ? isHost
              ? "● hosting & playing"
              : "● live"
            : "reconnecting · draft saved"}
        </span>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-8 text-center"
      >
        <p className="mt-4 font-mono text-micro uppercase tracking-[0.2em] text-white/45">
          {round ? `word ${round.number} of ${round.total}` : snapshot.deckName}
        </p>
        {snapshot.phase === "lobby" ? (
          isHost && hostInvite ? (
            <HostPlayerLobby
              roomId={credentials.roomId}
              invite={hostInvite}
              players={snapshot.players}
              currentPlayerId={credentials.playerId}
              onReadyChange={(ready) => void setReady(ready)}
              onStart={() => void sendHostAction("round.start")}
            />
          ) : (
            <section className="flex flex-1 flex-col justify-center">
              <h1 className="font-serif text-5xl font-semibold">You’re in.</h1>
              <p className="mt-4 font-serif text-lg text-white/60">
                The host will start when everyone is ready.
              </p>
              <button
                type="button"
                aria-pressed={player?.ready ?? true}
                onClick={() => void setReady(!(player?.ready ?? true))}
                className="mx-auto mt-6 min-h-12 rounded-full border border-white/20 px-6 font-mono text-xs font-semibold"
              >
                {player?.ready ? "ready · tap to wait" : "not ready · tap when ready"}
              </button>
            </section>
          )
        ) : snapshot.phase === "finished" ? (
          <section className="flex flex-1 flex-col justify-center">
            <h1 className="font-serif text-5xl font-semibold">Final scores.</h1>
            <ScoreList players={leaderboard} />
            {isHost ? (
              <button
                type="button"
                onClick={() => void handleLeave()}
                className="mt-8 min-h-14 w-full rounded-full border border-white/20 px-6 font-mono text-sm font-semibold"
              >
                start a new game
              </button>
            ) : null}
          </section>
        ) : (
          <>
            <section className="pt-8">
              <TextMorph
                as="h1"
                className="break-words font-serif text-6xl font-semibold leading-none [overflow-wrap:anywhere]"
              >
                {stage.label}
              </TextMorph>
              {stage.seconds !== null && snapshot.phase !== "reveal" ? (
                <p className="mt-4 font-mono text-xl text-white/55">{stage.seconds}s</p>
              ) : null}
            </section>
            {snapshot.phase === "answer" && !player?.locked ? (
              <>
                <DraftDisplay draft={draft} />
                <PartyKeyboard onLetter={addLetter} onBackspace={backspace} />
                <button
                  type="button"
                  onClick={() => void lock()}
                  className="mt-4 min-h-14 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black"
                >
                  lock it in
                </button>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={round?.repeatUsed}
                    onClick={() => requestClue("repeat")}
                    className="min-h-12 rounded-full border border-white/15 px-2 font-mono text-micro disabled:opacity-30"
                  >
                    hear again
                  </button>
                  <button
                    type="button"
                    disabled={round?.definitionUsed}
                    onClick={() => requestClue("definition")}
                    className="min-h-12 rounded-full border border-white/15 px-2 font-mono text-micro disabled:opacity-30"
                  >
                    definition
                  </button>
                  <button
                    type="button"
                    disabled={!round?.sentenceCluesRemaining}
                    onClick={() => requestClue("sentence")}
                    className="min-h-12 rounded-full border border-white/15 px-2 font-mono text-micro disabled:opacity-30"
                  >
                    sentence · {round?.sentenceCluesRemaining}
                  </button>
                </div>
              </>
            ) : null}
            {(snapshot.phase === "answer" || snapshot.phase === "locked") && player?.locked ? (
              <section className="flex flex-1 flex-col justify-center">
                <h2 className="font-serif text-4xl font-semibold">Locked in.</h2>
                <p className="mt-3 font-serif text-lg text-white/55">Waiting for everyone else.</p>
              </section>
            ) : null}
            {snapshot.phase === "reveal" && round ? (
              <section className="mt-8">
                <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">
                  {ownReveal?.correct
                    ? "correct"
                    : ownReveal?.distance === 1
                      ? "one letter away"
                      : "not this time"}
                </p>
                <p className="mt-4 font-serif text-2xl text-white/60">
                  you wrote · {ownReveal?.answer || "no answer"}
                </p>
                {round.answers ? (
                  <PartyClosenessBoard
                    answers={round.answers}
                    currentPlayerId={credentials.playerId}
                  />
                ) : null}
                <p className="mt-6 font-serif text-lg text-white/50">
                  Scores are saved for the final reveal.
                </p>
                <PartyRoundCooldown
                  progress={stage.cooldownProgress}
                  seconds={stage.seconds}
                  finalRound={round.number >= round.total}
                  onTogglePause={
                    isHost
                      ? () =>
                          void sendHostAction(
                            round.nextRoundAt === null ? "round.resume" : "round.pause",
                          )
                      : undefined
                  }
                />
              </section>
            ) : null}
          </>
        )}
        {isHost &&
        round &&
        snapshot.phase !== "lobby" &&
        snapshot.phase !== "finished" &&
        snapshot.phase !== "reveal" ? (
          <button
            type="button"
            onClick={replayHostAudio}
            className="mx-auto mt-4 min-h-11 px-4 font-mono text-xs text-white/55"
          >
            play word again
          </button>
        ) : null}
        {snapshot.recentClues.at(-1) ? (
          isHost ? (
            <button
              type="button"
              onClick={() => {
                const clue = snapshot.recentClues.at(-1);
                if (clue) void playPartySpeech(clue.audioUrl, clue.speechText, round?.speechLocale);
              }}
              className="mt-4 min-h-11 font-mono text-xs text-amber-200"
            >
              {snapshot.recentClues.at(-1)?.message}
            </button>
          ) : (
            <p className="mt-4 font-mono text-xs text-amber-200">
              {snapshot.recentClues.at(-1)?.message}
            </p>
          )
        ) : null}
        <p aria-live="polite" className="mt-3 min-h-5 font-mono text-xs text-amber-200">
          {live.message}
        </p>
      </main>
      {endConfirmationOpen ? (
        <EndGameDialog
          tone="dark"
          eyebrow={isHost ? "end party" : "leave game"}
          title={isHost ? "End for everyone?" : "Leave this game?"}
          description={
            isHost
              ? "The room will close and every player’s game will end. This cannot be undone."
              : "Your place in this game will be cleared. You cannot rejoin after the round starts."
          }
          confirmLabel={isHost ? "end party" : "leave game"}
          pending={leaving}
          onCancel={() => setEndConfirmationOpen(false)}
          onConfirm={() => void handleLeave()}
        />
      ) : null}
      {sentenceClueConfirmationOpen ? (
        <GameActionDialog
          tone="dark"
          eyebrow="sentence clue"
          title="Use a shared clue?"
          description={`This uses one of the room’s ${round?.sentenceCluesRemaining ?? 0} sentence clues for everyone.`}
          cancelLabel="keep clue"
          confirmLabel="use clue"
          pending={requestingSentenceClue}
          pendingLabel="requesting…"
          onCancel={() => setSentenceClueConfirmationOpen(false)}
          onConfirm={() => void confirmSentenceClue()}
        />
      ) : null}
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
          onConfirm={() => void confirmStart()}
        />
      ) : null}
    </div>
  );
}

function HostPlayerLobby({
  roomId,
  invite,
  players,
  currentPlayerId,
  onReadyChange,
  onStart,
}: {
  roomId: string;
  invite: string;
  players: Array<{ id: string; name: string; ready: boolean }>;
  currentPlayerId: string;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const { dataUrl: qr, failed: qrFailed } = useQrCode(invite, 280);
  const currentPlayer = players.find(({ id }) => id === currentPlayerId);
  const shareInvite = async () => {
    const share = {
      title: "Join our Spelling Bee",
      text: `Join room ${roomId} and type along.`,
      url: invite,
    };
    const result = await shareOrCopy(share, { copyValue: invite });
    if (result === "shared") setMessage("Invite shared.");
    else if (result === "copied") setMessage("Player link copied.");
    else if (result === "failed")
      setMessage("Ask players to scan the code or enter the room code.");
  };
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center py-6"
      aria-labelledby="host-lobby-title"
    >
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-amber-200">
        you’re hosting & playing
      </p>
      <h1 id="host-lobby-title" className="mt-3 font-serif text-5xl font-semibold">
        Invite your players.
      </h1>
      <p className="mt-3 max-w-sm font-serif text-lg text-white/55">
        They can scan this code. You’ll compete from this phone and control when each word starts.
      </p>
      {qr ? (
        <img
          src={qr}
          alt="QR code for players to join this spelling room"
          className="mt-6 w-52 rounded-3xl bg-white p-3"
        />
      ) : qrFailed ? (
        <p className="mt-5 font-mono text-xs text-white/50">
          QR unavailable—share the player link or room code.
        </p>
      ) : null}
      <p className="mt-4 font-mono text-micro uppercase tracking-[0.18em] text-white/40">
        room code
      </p>
      <p className="mt-1 font-mono text-2xl tracking-[0.2em]">{roomId}</p>
      <button
        type="button"
        onClick={() => void shareInvite()}
        className="mt-4 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm font-semibold"
      >
        share player invite
      </button>
      <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-amber-200">
        {message}
      </p>
      <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Players in the room">
        {players.map((player) => (
          <li
            key={player.id}
            className="rounded-full border border-white/15 px-4 py-2 font-mono text-sm"
          >
            {player.name} · {player.ready !== false ? "ready" : "not ready"}
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-xs text-white/45">
        {players.length === 1
          ? "Just you so far"
          : `${players.filter(({ ready }) => ready !== false).length} of ${players.length} ready`}
      </p>
      <button
        type="button"
        aria-pressed={currentPlayer?.ready ?? true}
        onClick={() => onReadyChange(!(currentPlayer?.ready ?? true))}
        className="mt-4 min-h-12 rounded-full border border-white/20 px-6 font-mono text-xs font-semibold"
      >
        {currentPlayer?.ready ? "ready · tap to wait" : "not ready · tap when ready"}
      </button>
      <button
        type="button"
        onClick={onStart}
        className="mt-6 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black"
      >
        start game
      </button>
    </section>
  );
}

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function DraftDisplay({ draft }: { draft: string }) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rail.current?.scrollTo({ left: rail.current.scrollWidth, behavior: "smooth" });
  }, [draft]);
  return (
    <div
      ref={rail}
      className="mt-8 h-16 overflow-x-auto overflow-y-hidden overscroll-x-contain"
      aria-label={draft ? `Your spelling: ${draft.split("").join(" ")}` : "Your spelling is blank"}
    >
      <div className="mx-auto flex h-16 w-max min-w-full items-center justify-center gap-1.5 px-1">
        {draft.split("").map((letter, index) => (
          <span
            key={`${index}-${letter}`}
            className="flex h-12 min-w-9 items-center justify-center rounded-xl border border-white/20 bg-white/[0.07] px-2 font-mono text-xl"
          >
            {letter}
          </span>
        ))}
        {!draft ? <span className="font-serif text-lg text-white/35">start typing</span> : null}
      </div>
    </div>
  );
}

function PartyKeyboard({
  onLetter,
  onBackspace,
}: {
  onLetter: (letter: string) => void;
  onBackspace: () => void;
}) {
  return (
    <div className="mt-6 grid select-none gap-2 touch-manipulation" aria-label="Spelling keyboard">
      {KEY_ROWS.map((row, rowIndex) => (
        <div
          key={row}
          className={`grid gap-1.5 ${
            rowIndex === 0
              ? "grid-cols-10"
              : rowIndex === 1
                ? "grid-cols-9 px-[5%]"
                : "grid-cols-[repeat(7,minmax(0,1fr))_1.45fr] px-[8%]"
          }`}
        >
          {row.split("").map((letter) => (
            <button
              key={letter}
              type="button"
              aria-label={letter}
              onClick={() => onLetter(letter)}
              className="h-13 min-w-0 rounded-xl border border-white/15 bg-white/[0.07] font-mono text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-white/75 active:translate-y-px active:bg-white/20"
            >
              {letter}
            </button>
          ))}
          {rowIndex === 2 ? (
            <button
              type="button"
              aria-label="Backspace"
              onClick={onBackspace}
              className="h-13 min-w-0 rounded-xl border border-white/15 bg-white/[0.07] font-mono text-base shadow-sm focus-visible:ring-2 focus-visible:ring-white/75 active:translate-y-px active:bg-white/20"
            >
              ⌫
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
function ScoreList({ players }: { players: Array<{ id: string; name: string; score: number }> }) {
  return (
    <ol className="mt-8 border-t border-white/12">
      {players.map((player, index) => (
        <li
          key={player.id}
          className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-white/12 py-3 text-left transition-transform motion-reduce:transition-none"
        >
          <span className="font-mono text-xs text-white/40">{index + 1}</span>
          <span className="font-serif text-xl">{player.name}</span>
          <span className="font-mono text-sm">{player.score}</span>
        </li>
      ))}
    </ol>
  );
}
function PlayerMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main
      id="main"
      className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"
    >
      <div>
        <h1 className="font-serif text-5xl font-semibold">{title}</h1>
        <p className="mt-4 font-serif text-lg text-white/60">{detail}</p>
      </div>
    </main>
  );
}
