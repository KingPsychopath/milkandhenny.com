import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { applyPresenterActionFn, closePartyRoomFn } from "./party-room.functions";
import { usePartyLiveSnapshot } from "./usePartyLiveSnapshot";
import { useSynchronizedPartyStage } from "./useSynchronizedPartyStage";
import { PartyClosenessBoard } from "./PartyClosenessBoard";
import { PartyRoundCooldown } from "./PartyRoundCooldown";
import type { PartyClueEvent, PartyPresenterAction } from "./types";
import { partyBrowserKeys } from "./party-keys";
import {
  readExpiringLocalValue,
  removeStorageKeys,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { useWakeLock } from "@/hooks/useWakeLock";
import { playPartySpeech, unlockPartyAudio } from "./party-audio.client";
import { EndGameDialog } from "../shared/EndGameDialog";
import { GameActionDialog } from "../shared/GameActionDialog";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { buildPartyPlayerInviteUrl, parsePartyPresenterFragment } from "./party-invite";
import { LobbyIntro, MultiplayerLobby } from "../shared/MultiplayerLobby";
import { ThingsRoomHeader } from "../shared/RoomHeader";
import type { MultiplayerActionInput } from "../shared/multiplayer";
import { useReliableMultiplayerAction } from "../shared/useReliableMultiplayerAction";
import { RoomUnavailableState } from "../shared/RoomUnavailableState";
import { useRoomUnavailableRecovery } from "../shared/useRoomUnavailableRecovery";

function roomTokens(roomId: string) {
  const sessionKey = partyBrowserKeys.presenterSession(roomId);
  const recoveryKey = partyBrowserKeys.presenterRecovery(roomId);
  const fragment = consumeLocationFragment();
  if (fragment) {
    const invite = parsePartyPresenterFragment(fragment);
    const session = {
      presenterToken: invite.presenterToken,
      joinToken: invite.joinToken,
    };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    if (invite.expiresAt && invite.expiresAt > Date.now())
      writeExpiringLocalValue(recoveryKey, session, invite.expiresAt);
    return session;
  }
  try {
    const current = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as {
      presenterToken?: unknown;
      joinToken?: unknown;
    } | null;
    if (typeof current?.presenterToken === "string" && typeof current.joinToken === "string")
      return { presenterToken: current.presenterToken, joinToken: current.joinToken };
  } catch {
    sessionStorage.removeItem(sessionKey);
  }
  const recovered = readExpiringLocalValue<{ presenterToken: string; joinToken: string }>(
    recoveryKey,
  );
  if (
    recovered &&
    typeof recovered.presenterToken === "string" &&
    typeof recovered.joinToken === "string"
  ) {
    sessionStorage.setItem(sessionKey, JSON.stringify(recovered));
    return recovered;
  }
  return { presenterToken: "", joinToken: "" };
}

export function PartyPresenterApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState({ presenterToken: "", joinToken: "" });
  const [tokensReadyForRoom, setTokensReadyForRoom] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [removePlayerIds, setRemovePlayerIds] = useState<string[] | null>(null);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const playedAudio = useRef(new Set<string>());
  const haptics = useWebHaptics();
  useEffect(() => {
    setTokens(roomTokens(roomId));
    setTokensReadyForRoom(roomId);
  }, [roomId]);
  const live = usePartyLiveSnapshot({
    roomId,
    role: "presenter",
    credential: tokens.presenterToken,
  });
  const stage = useSynchronizedPartyStage(live.snapshot, live.clockOffset);
  const snapshot = live.snapshot;
  const { roomUnavailable, markUnavailable } = useRoomUnavailableRecovery({
    roomKey: roomId,
    unavailable: live.ended,
    onUnavailable: () => {
      sessionStorage.removeItem(partyBrowserKeys.presenterSession(roomId));
      removeStorageKeys(localStorage, [partyBrowserKeys.presenterRecovery(roomId)]);
    },
  });
  useUpdateReloadSafety(
    "spelling-party-presenter",
    snapshot?.phase === "lobby" || snapshot?.phase === "finished",
  );
  // The shared screen is never touched once a round is under way.
  useWakeLock(Boolean(snapshot) && snapshot?.phase !== "finished");
  const setMessage = live.setMessage;
  const invite = tokens.joinToken
    ? buildPartyPlayerInviteUrl(location.origin, roomId, tokens.joinToken)
    : null;

  useEffect(() => {
    const round = snapshot?.round;
    if (!round || snapshot?.phase !== "countdown") return;
    const audio = round.wordAudioUrl ? new Audio(round.wordAudioUrl) : null;
    if (audio) {
      audio.preload = "auto";
      audio.load();
    }
    const delay = Math.max(0, round.audioPlaysAt - (Date.now() + live.clockOffset));
    const timer = window.setTimeout(() => {
      if (playedAudio.current.has(`word:${round.roundId}`)) return;
      playedAudio.current.add(`word:${round.roundId}`);
      const playback = playPartySpeech(round.wordAudioUrl, round.spokenWord, round.speechLocale);
      void playback
        .then((played) => {
          if (played === false) setMessage("Tap ‘play word’—this browser blocked automatic audio.");
        })
        .catch(() => setMessage("Tap ‘play word’—this browser blocked automatic audio."));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [live.clockOffset, setMessage, snapshot?.phase, snapshot?.round]);

  const clueId = snapshot?.round?.activeClue?.id;
  useEffect(() => {
    const clue = snapshot?.round?.activeClue;
    if (!clue || playedAudio.current.has(`clue:${clue.id}`)) return;
    playedAudio.current.add(`clue:${clue.id}`);
    const playback = playPartySpeech(clue.audioUrl, clue.speechText, snapshot?.round?.speechLocale);
    void playback
      .then((played) => {
        if (played === false) setMessage("Tap the clue notice to play it.");
      })
      .catch(() => setMessage("Tap the clue notice to play it."));
  }, [clueId, setMessage, snapshot?.round?.activeClue, snapshot?.round?.speechLocale]);

  const previousStage = useRef("");
  const previousPhase = useRef(snapshot?.phase);
  useEffect(() => {
    if (stage.label === previousStage.current) return;
    if (/^[123]$/.test(stage.label)) void haptics.trigger("selection");
    previousStage.current = stage.label;
  }, [haptics, stage.label]);
  useEffect(() => {
    if (snapshot?.phase === "answer" && previousPhase.current !== "answer")
      void haptics.trigger("selection");
    if (snapshot?.phase === "finished" && previousPhase.current !== "finished")
      void haptics.trigger("success");
    previousPhase.current = snapshot?.phase;
  }, [haptics, snapshot?.phase]);

  const dispatchPresenterAction = useReliableMultiplayerAction(
    (action: MultiplayerActionInput<PartyPresenterAction>, actionId) =>
      applyPresenterActionFn({
        data: {
          roomId,
          presenterToken: tokens.presenterToken,
          action:
            action.type === "round.start"
              ? { ...action, actionId }
              : { actionId, type: action.type },
        },
      }),
    `${roomId}:presenter:${snapshot?.sequence ?? "loading"}`,
  );

  const send = async (type: PartyPresenterAction["type"], removePlayerIds?: string[]) => {
    if (!tokens.presenterToken) return;
    unlockPartyAudio();
    try {
      const result = await dispatchPresenterAction(
        type === "round.start" ? { type, removePlayerIds } : { type },
      );
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.accepted) {
        if (result.errorCode === "room_unavailable") markUnavailable();
        live.setMessage(result.error ?? "That action is not ready yet.");
        if (result.errorCode === "players_not_ready" && result.snapshot) {
          const unready = result.snapshot.players.filter(({ ready }) => !ready);
          if (unready.length > 0 && unready.length < result.snapshot.players.length)
            setRemovePlayerIds(unready.map(({ id }) => id));
        }
        live.notify();
      } else {
        setRemovePlayerIds(null);
        live.notify();
        live.setMessage(null);
      }
    } catch {
      live.setMessage("Reconnecting… Try that once more.");
    }
  };

  const confirmStart = async () => {
    if (!removePlayerIds) return;
    setConfirmingStart(true);
    try {
      await send("round.start", removePlayerIds);
    } finally {
      setConfirmingStart(false);
    }
  };

  const replay = () => {
    const currentRound = live.snapshot?.round;
    if (currentRound)
      void playPartySpeech(
        currentRound.wordAudioUrl,
        currentRound.spokenWord,
        currentRound.speechLocale,
      ).then((played) => {
        if (!played) live.setMessage("Audio could not play on this screen.");
      });
  };
  const replayClue = (clue: PartyClueEvent) => {
    void playPartySpeech(clue.audioUrl, clue.speechText, snapshot?.round?.speechLocale).then(
      (played) => {
        if (!played) live.setMessage("That clue could not play.");
      },
    );
  };
  const handleEnd = async (confirmFirst = true) => {
    if (closing || !tokens.presenterToken) return;
    if (confirmFirst && snapshot?.phase !== "finished" && players.length > 0) {
      setEndConfirmationOpen(true);
      return;
    }
    setEndConfirmationOpen(false);
    setClosing(true);
    await closePartyRoomFn({ data: { roomId, presenterToken: tokens.presenterToken } }).catch(
      () => null,
    );
    sessionStorage.removeItem(partyBrowserKeys.presenterSession(roomId));
    removeStorageKeys(localStorage, [partyBrowserKeys.presenterRecovery(roomId)]);
    await navigate({ to: "/things/spelling-party" });
  };
  const players = snapshot?.players ?? [];
  const leaderboard = useMemo(
    () =>
      [...(snapshot?.players ?? [])].sort(
        (left, right) => right.score - left.score || left.name.localeCompare(right.name),
      ),
    [snapshot?.players],
  );

  if (tokensReadyForRoom !== roomId)
    return <PartyScreenMessage title="Opening the room…" detail="Keep this screen open." />;
  if (!tokens.presenterToken)
    return (
      <PartyScreenMessage
        title="Shared-screen access missing"
        detail="Open the private shared-screen link created with this room."
      />
    );
  if (roomUnavailable)
    return (
      <div className="things-game things-game--night text-white">
        <RoomUnavailableState gameName="spelling party" gamePath="/things/spelling-party" />
      </div>
    );
  if (!snapshot)
    return (
      <PartyScreenMessage
        title="Opening the room…"
        detail={live.message ?? "Keep this screen open."}
      />
    );
  const round = snapshot.round;
  return (
    <div className="things-game things-game--night text-white">
      <ThingsRoomHeader
        tone="night"
        back={<span className="things-room-header-utility">spelling party</span>}
        roomId={roomId}
        connection={live.connectionState}
        right={
          <>
            <button
              type="button"
              onClick={() => void handleEnd()}
              disabled={closing}
              className="things-room-header-cta disabled:opacity-40"
            >
              {closing ? "ending…" : "end game"}
            </button>
          </>
        }
      />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-10">
        {snapshot.phase === "lobby" ? (
          <section className="flex flex-1 flex-col justify-center py-8">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
              {snapshot.deckName}
            </p>
            <LobbyIntro
              title="Get everyone on a phone."
              description="Type the same word from different phones, then see whose spelling was closest."
              rules="The host reads the clue aloud. Everyone types one answer on their own phone, and the room compares the spellings when time is up."
            />
            <MultiplayerLobby
              actions={
                <button
                  type="button"
                  onClick={() => void send("round.start")}
                  disabled={!players.length}
                  className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-30"
                >
                  start round
                </button>
              }
              currentPlayerId={null}
              inviteLabel="room code"
              inviteText="Join our spelling party."
              inviteTitle="Spelling party"
              inviteUrl={invite}
              players={players.map((player) => ({
                id: player.id,
                name: player.name,
                ready: player.ready !== false,
              }))}
              roomId={roomId}
              settings={
                <p className="font-mono text-xs text-white/45">
                  {players.length
                    ? `${players.filter(({ ready }) => ready !== false).length} of ${players.length} ready`
                    : "waiting for the first player"}
                </p>
              }
            />
          </section>
        ) : snapshot.phase === "finished" ? (
          <section className="flex flex-1 flex-col justify-center py-10 text-center">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
              {snapshot.gameNumber > 1 ? `game ${snapshot.gameNumber} scores` : "final scores"}
            </p>
            <h1 className="mt-3 font-serif text-6xl font-semibold">
              {leaderboard[0]?.name ?? "Well played"}
            </h1>
            <Leaderboard players={leaderboard} />
            <div className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void send("game.replay")}
                disabled={!players.length}
                className="min-h-12 rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black disabled:opacity-30"
              >
                play again · same people
              </button>
              <button
                type="button"
                onClick={() => void send("game.lobby")}
                className="min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm"
              >
                back to the lobby
              </button>
              <button
                type="button"
                onClick={() => void handleEnd()}
                disabled={closing}
                className="min-h-12 px-4 font-mono text-xs text-white/45 disabled:opacity-40"
              >
                {closing ? "closing room…" : "new room"}
              </button>
            </div>
          </section>
        ) : (
          <>
            <section
              className="flex flex-1 flex-col items-center justify-center py-8 text-center"
              aria-live="polite"
            >
              <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
                word {round?.number} of {round?.total}
              </p>
              <TextMorph
                as="h1"
                className="mt-4 break-words font-serif text-7xl font-semibold leading-none [overflow-wrap:anywhere]"
              >
                {stage.label}
              </TextMorph>
              {stage.seconds !== null && snapshot.phase !== "reveal" ? (
                <p className="mt-4 font-mono text-xl text-white/55">{stage.seconds}s</p>
              ) : null}
              {snapshot.phase === "answer" ? (
                <p className="mt-6 font-serif text-xl text-white/55">
                  {players.filter(({ status }) => status === "locked").length} of {players.length}{" "}
                  locked in
                </p>
              ) : null}
              {snapshot.phase === "locked" ? (
                <p className="mt-5 font-serif text-lg text-white/55">Everyone reveals together.</p>
              ) : null}
              {snapshot.phase === "reveal" && round ? (
                <div className="mt-8 w-full">
                  <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">
                    closest spellings
                  </p>
                  {round.answers ? <PartyClosenessBoard answers={round.answers} /> : null}
                  <p className="mt-6 font-serif text-base text-white/45">
                    Scores stay hidden until the end.
                  </p>
                  <PartyRoundCooldown
                    progress={stage.cooldownProgress}
                    seconds={stage.seconds}
                    finalRound={round.number >= round.total}
                    onTogglePause={() =>
                      void send(round.nextRoundAt === null ? "round.resume" : "round.pause")
                    }
                  />
                </div>
              ) : null}
            </section>
            {snapshot.phase !== "reveal" ? (
              <section className="rounded-3xl border border-white/12 p-4">
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {players.map((player) => (
                    <li
                      key={player.id}
                      className="flex min-h-12 items-center justify-between rounded-2xl bg-white/[0.04] px-3"
                    >
                      <span className="truncate font-serif">{player.name}</span>
                      <span className="font-mono text-micro text-white/45">{player.status}</span>
                    </li>
                  ))}
                </ul>
                {snapshot.recentClues.at(-1) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const clue = snapshot.recentClues.at(-1);
                      if (clue) replayClue(clue);
                    }}
                    className="mt-3 min-h-11 w-full text-left font-mono text-xs text-amber-200"
                  >
                    {snapshot.recentClues.at(-1)?.message}
                  </button>
                ) : null}
              </section>
            ) : null}
          </>
        )}
        {round && snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
          <button
            type="button"
            onClick={replay}
            className="mx-auto mt-3 min-h-11 px-4 font-mono text-xs text-white/45"
          >
            play word again on this screen
          </button>
        ) : null}
        <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200">
          {live.message}
        </p>
      </main>
      {endConfirmationOpen ? (
        <EndGameDialog
          tone="dark"
          eyebrow="end party"
          title="End for everyone?"
          description="Players will see that the room has ended. This cannot be undone."
          confirmLabel="end party"
          pending={closing}
          onCancel={() => setEndConfirmationOpen(false)}
          onConfirm={() => void handleEnd(false)}
        />
      ) : null}
      {removePlayerIds ? (
        <GameActionDialog
          tone="dark"
          eyebrow="players not ready"
          title={
            players.some(({ id, ready }) => removePlayerIds.includes(id) && !ready)
              ? "Start without them?"
              : "Everyone is ready now."
          }
          description={(() => {
            const names = players
              .filter(({ id, ready }) => removePlayerIds.includes(id) && !ready)
              .map(({ name }) => name);
            return names.length
              ? `${names.join(" and ")} will be removed from this game.`
              : "No one will be removed.";
          })()}
          cancelLabel="keep waiting"
          confirmLabel={
            players.some(({ id, ready }) => removePlayerIds.includes(id) && !ready)
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

function Leaderboard({ players }: { players: Array<{ id: string; name: string; score: number }> }) {
  return (
    <ol className="mx-auto mt-8 max-w-md border-t border-white/12">
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
function PartyScreenMessage({ title, detail }: { title: string; detail: string }) {
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
