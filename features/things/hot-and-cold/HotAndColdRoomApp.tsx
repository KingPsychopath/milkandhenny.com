import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { AppImage } from "@/components/AppImage";
import { AppSelect } from "@/components/AppSelect";
import { useQrCode } from "@/hooks/useQrCode";
import type { GuessSubmissionResult } from "../shared/guess-submission";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { GiveUpControl } from "../shared/GiveUpControl";
import { PlayerReadyControl } from "../shared/PlayerReadyControl";
import { GameActionDialog } from "../shared/GameActionDialog";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { applyHotAndColdActionFn, joinHotAndColdRoomFn } from "./hot-and-cold.functions";
import { buildHotAndColdInviteUrl } from "./hot-and-cold-invite";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { heatStreaks } from "./hot-and-cold-rules";
import { HeatGauge } from "./HeatGauge";
import { HeatLedger } from "./HeatLedger";
import { GuessComposer } from "./GuessComposer";
import { HotAndColdResultShare, HotAndColdShareDock } from "./HotAndColdResultShare";
import { useHotAndColdWordVisibility, WordVisibilityControl } from "./WordVisibilityControl";
import { useHotAndColdRoom } from "./useHotAndColdRoom";
import type { HotAndColdAction, HotAndColdActionResult, HotAndColdCredentials } from "./types";
import type { MultiplayerActionInput } from "../shared/multiplayer";

type HotAndColdSendErrorCode =
  | Extract<HotAndColdActionResult, { accepted: false }>["errorCode"]
  | "network_error";

type HotAndColdSendResult =
  | { accepted: true }
  | { accepted: false; errorCode: HotAndColdSendErrorCode };

export function JoinHotAndColdRoom({
  roomId,
  joinToken,
  onJoined,
}: {
  roomId: string;
  joinToken: string;
  onJoined: (credentials: HotAndColdCredentials) => void;
}) {
  const { loaded, name, setName, remember } = useRememberedPlayerName(24);
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const join = async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    try {
      const result = await joinHotAndColdRoomFn({
        data: {
          roomId,
          name: name.trim(),
          joinToken: joinToken || undefined,
        },
      });
      if (!result.ok) {
        setMessage(result.error);
        setJoining(false);
        return;
      }
      remember(name);
      onJoined(result);
    } catch {
      setMessage("Could not join this room");
      setJoining(false);
    }
  };
  return (
    <div className="hot-and-cold min-h-svh">
      <header className="mx-auto max-w-lg px-5 pt-3">
        <Link
          to="/things/hot-and-cold"
          className="inline-flex min-h-11 items-center font-mono text-xs theme-muted"
        >
          ← hot and cold
        </Link>
      </header>
      <main id="main" className="mx-auto flex min-h-[75svh] max-w-lg flex-col justify-center px-5">
        <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">room {roomId}</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">join the hunt</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label className="mt-9 block font-mono text-xs theme-muted">
            <span className="block pb-2">your name</span>
            <input
              autoFocus={loaded && !name}
              name="name"
              value={name}
              maxLength={24}
              autoComplete="name"
              enterKeyHint="go"
              required
              aria-invalid={Boolean(message) || undefined}
              aria-describedby={message ? "hot-and-cold-join-message" : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void join();
              }}
              className="min-h-14 w-full border-b theme-border bg-transparent font-serif text-3xl"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || joining}
            className="mt-9 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black disabled:opacity-40"
          >
            {joining ? "joining…" : "join room"}
          </button>
          {message ? (
            <p
              id="hot-and-cold-join-message"
              role="alert"
              className="mt-4 font-mono text-xs text-[var(--things-amber)]"
            >
              {message}
            </p>
          ) : null}
        </form>
      </main>
    </div>
  );
}

export function HotAndColdRoomApp({
  credentials,
  onLeave,
}: {
  credentials: HotAndColdCredentials;
  onLeave: () => void;
}) {
  const live = useHotAndColdRoom({
    roomId: credentials.roomId,
    playerId: credentials.playerId,
    playerToken: credentials.playerToken,
    initialSnapshot: credentials.snapshot,
  });
  const haptics = useWebHaptics();
  const [message, setMessage] = useState<string | null>(null);
  const [newest, setNewest] = useState<string | null>(null);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const snapshot = live.snapshot;
  const turnIdentity = `${snapshot?.phase ?? "loading"}:${snapshot?.round?.id ?? ""}:${snapshot?.round?.currentPlayerId ?? ""}`;
  const { wordsHidden, toggleWords } = useHotAndColdWordVisibility(
    `room:${snapshot?.round?.id ?? "waiting"}`,
  );
  useEffect(() => {
    if (!snapshot) return;
    writeExpiringLocalValue(
      hotAndColdBrowserKeys.playerSession(credentials.roomId),
      { ...credentials, expiresAt: snapshot.expiresAt, snapshot },
      snapshot.expiresAt,
    );
  }, [credentials, snapshot]);
  const invite =
    typeof location === "undefined"
      ? ""
      : buildHotAndColdInviteUrl(location.origin, credentials.roomId, credentials.joinToken);
  const { dataUrl: inviteQr, failed: inviteQrFailed } = useQrCode(
    snapshot?.phase === "lobby" ? invite : null,
    320,
  );
  const latestId = snapshot?.round?.guesses.at(-1)?.id;
  useEffect(() => {
    if (!latestId) return;
    setNewest(latestId);
    const guess = snapshot?.round?.guesses.find(({ id }) => id === latestId);
    if (guess && guess.playerId === credentials.playerId) {
      setMessage(null);
      void haptics.trigger(
        guess.rank === 0 ? "success" : guess.rank < 500 ? "warning" : "selection",
      );
    }
  }, [credentials.playerId, haptics, latestId, snapshot?.round?.guesses]);
  useEffect(() => {
    setMessage(null);
  }, [turnIdentity]);
  const send = async (
    action: MultiplayerActionInput<HotAndColdAction>,
  ): Promise<HotAndColdSendResult> => {
    try {
      const result = await applyHotAndColdActionFn({
        data: {
          roomId: credentials.roomId,
          playerId: credentials.playerId,
          playerToken: credentials.playerToken,
          action: { ...action, actionId: crypto.randomUUID() },
        },
      });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      live.notify();
      if (!result.accepted) {
        setMessage(result.error);
        return { accepted: false, errorCode: result.errorCode };
      }
      return { accepted: true };
    } catch {
      setMessage("Could not reach the room");
      return { accepted: false, errorCode: "network_error" };
    }
  };
  const submitGuess = async (word: string): Promise<GuessSubmissionResult> => {
    const result = await send({
      type: "guess.submit",
      word,
      roundId: snapshot?.round?.id ?? "",
    });
    if (result.accepted) return "accepted";
    return result.errorCode === "duplicate_guess" ? "discarded" : "retryable";
  };
  const leave = async () => {
    const result = await send({ type: "player.leave" });
    if (result.accepted) onLeave();
  };
  if (!snapshot)
    return (
      <div className="hot-and-cold grid min-h-svh place-items-center font-mono text-xs">
        {live.message ?? "warming the room…"}
      </div>
    );
  const me = snapshot.players.find(({ id }) => id === credentials.playerId);
  const current = snapshot.players.find(({ id }) => id === snapshot.round?.currentPlayerId);
  const notReady = snapshot.players.filter(({ ready, withdrawn }) => !withdrawn && !ready);
  const myTurn = snapshot.phase === "playing" && current?.id === credentials.playerId;
  const guesses = (snapshot.round?.guesses ?? []).map((guess) => ({
    ...guess,
    mine: guess.playerId === credentials.playerId,
  }));
  const hottest = guesses.reduce<(typeof guesses)[number] | null>(
    (best, guess) => (!best || guess.rank < best.rank ? guess : best),
    null,
  );
  const newestGuess = newest ? guesses.find(({ id }) => id === newest) : null;
  const receipt =
    newestGuess?.mine && newestGuess.rank !== 0
      ? {
          id: newestGuess.id,
          label: `${newestGuess.word} · #${newestGuess.rank.toLocaleString()}${
            newestGuess.id === hottest?.id ? " · hottest" : ""
          }`,
        }
      : null;
  const streak = heatStreaks(guesses);
  if (snapshot.phase === "lobby") {
    return (
      <div className="hot-and-cold min-h-svh">
        <header className="mx-auto flex max-w-lg items-center justify-between px-5 pt-3 font-mono text-xs theme-muted">
          <button type="button" onClick={() => void leave()} className="min-h-11">
            ← hot and cold
          </button>
          <span>{snapshot.roomId}</span>
        </header>
        <main id="main" className="mx-auto max-w-lg px-5 pb-20 pt-12">
          <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">
            the room is open
          </p>
          <h1 className="mt-3 font-serif text-5xl font-semibold">find the heat together.</h1>
          <section
            className="mt-8 flex flex-col items-center text-center"
            aria-label="Join the room"
          >
            {inviteQr ? (
              <AppImage
                src={inviteQr}
                alt={`QR code to join room ${snapshot.roomId}`}
                width={320}
                height={320}
                className="w-56 rounded-3xl bg-white p-3"
              />
            ) : inviteQrFailed ? (
              <p className="font-mono text-xs theme-muted">
                QR unavailable — use the room code or invite link.
              </p>
            ) : (
              <div className="grid size-56 place-items-center rounded-3xl border theme-border font-mono text-xs theme-muted">
                making QR…
              </div>
            )}
            <p className="mt-5 font-mono text-micro uppercase tracking-[.18em] theme-muted">
              scan to join
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-[.2em] text-[var(--things-amber)]">
              {snapshot.roomId}
            </p>
          </section>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(invite)}
            className="mt-7 min-h-12 w-full rounded-full border theme-border px-6 font-mono text-xs"
          >
            copy invite · {snapshot.roomId}
          </button>
          <ul className="mt-10 border-t theme-border">
            {snapshot.players
              .filter(({ withdrawn }) => !withdrawn)
              .map((player) => (
                <li
                  key={player.id}
                  className="flex min-h-14 items-center justify-between border-b theme-border font-mono text-xs"
                >
                  <span>
                    {player.name}
                    {player.id === credentials.playerId ? " · you" : ""}
                    {player.host ? " · lead" : ""}
                  </span>
                  <span className="theme-muted">{player.ready ? "ready" : "not ready"}</span>
                </li>
              ))}
          </ul>
          <PlayerReadyControl
            ready={me?.ready ?? false}
            tone="light"
            onChange={(ready) => void send({ type: "readiness.set", ready })}
          />
          <details className="mt-8 border-y theme-border py-3">
            <summary className="min-h-11 cursor-pointer font-mono text-xs theme-muted">
              room settings
            </summary>
            <div className="grid grid-cols-3 gap-3 pt-4 font-mono text-xs">
              <label>
                rounds
                <input
                  name="rounds"
                  type="number"
                  min="1"
                  max="7"
                  disabled={!snapshot.canControl || snapshot.managed}
                  value={snapshot.rounds}
                  onChange={(event) =>
                    void send({ type: "game.configure", rounds: Number(event.target.value) })
                  }
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-2"
                />
              </label>
              <label>
                guesses
                <input
                  name="guesses-per-player"
                  type="number"
                  min="2"
                  max="10"
                  disabled={!snapshot.canControl || snapshot.managed}
                  value={snapshot.guessesPerPlayer}
                  onChange={(event) =>
                    void send({
                      type: "game.configure",
                      guessesPerPlayer: Number(event.target.value),
                    })
                  }
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-2"
                />
              </label>
              <label>
                seconds
                <AppSelect
                  name="turn-seconds"
                  disabled={!snapshot.canControl || snapshot.managed}
                  value={snapshot.turnSeconds}
                  onValueChange={(value) =>
                    void send({ type: "game.configure", turnSeconds: Number(value) })
                  }
                  options={[10, 15, 20, 30, 0].map((value) => ({
                    value,
                    label: String(value || "∞"),
                  }))}
                  variant="field"
                  ariaLabel="Seconds per turn"
                  className="mt-2"
                />
              </label>
            </div>
          </details>
          {snapshot.canControl ? (
            <button
              type="button"
              onClick={() =>
                void send({ type: "game.start" }).then((result) => {
                  if (
                    !result.accepted &&
                    result.errorCode === "players_not_ready" &&
                    notReady.length > 0
                  ) {
                    setConfirmingStart(true);
                  }
                })
              }
              className="mt-8 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black"
            >
              start the hunt
            </button>
          ) : (
            <p className="mt-8 font-mono text-xs theme-muted">waiting for the room lead</p>
          )}
          {message ? (
            <p role="status" className="mt-4 font-mono text-xs text-[var(--things-amber)]">
              {message}
            </p>
          ) : null}
          {confirmingStart ? (
            <GameActionDialog
              tone="light"
              eyebrow="players not ready"
              title="Start anyway?"
              description={`${notReady.map(({ name }) => name).join(" and ")} ${
                notReady.length === 1 ? "hasn’t" : "haven’t"
              } confirmed they’re ready. Starting now removes them from this hunt.`}
              cancelLabel="keep waiting"
              confirmLabel="remove and start"
              onCancel={() => setConfirmingStart(false)}
              onConfirm={() => {
                setConfirmingStart(false);
                void send({
                  type: "game.start",
                  removePlayerIds: notReady.map(({ id }) => id),
                });
              }}
            />
          ) : null}
        </main>
      </div>
    );
  }
  if (snapshot.phase === "finished") {
    const winners = snapshot.players.filter(({ id }) => snapshot.winnerIds.includes(id));
    return (
      <div className="hot-and-cold min-h-svh">
        <main
          id="main"
          className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-5 py-16 text-center"
        >
          <p className="font-mono text-micro uppercase tracking-[.18em] theme-muted">
            final ledger
          </p>
          <h1 className="mt-3 font-serif text-5xl font-semibold">
            {winners.length
              ? `${winners.map(({ name }) => name).join(" & ")} win`
              : "a shared finish"}
          </h1>
          <ol className="mt-10 border-t theme-border text-left">
            {[...snapshot.players]
              .sort((a, b) => b.score - a.score)
              .map((player) => (
                <li
                  key={player.id}
                  className="flex min-h-14 items-center justify-between border-b theme-border"
                >
                  <span className="font-serif text-xl">{player.name}</span>
                  <span className="font-mono text-xs">
                    {player.score} round{player.score === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
          </ol>
          {snapshot.canControl ? (
            <button
              type="button"
              className="mt-8 min-h-14 rounded-full bg-[var(--things-amber)] font-mono text-xs font-bold text-black"
              onClick={() => void send({ type: "game.replay" })}
            >
              play again
            </button>
          ) : null}
          <button
            type="button"
            className="mt-3 min-h-11 font-mono text-xs theme-muted"
            onClick={() => void leave()}
          >
            leave room
          </button>
        </main>
      </div>
    );
  }
  const seconds = snapshot.round?.turnEndsAt
    ? Math.max(0, Math.ceil((snapshot.round.turnEndsAt - snapshot.serverNow) / 1_000))
    : null;
  return (
    <div className="hot-and-cold min-h-svh" data-words-hidden={wordsHidden || undefined}>
      <header className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-5 pt-3 font-mono text-xs theme-muted">
        <button type="button" className="min-h-11" onClick={() => void leave()}>
          ← leave
        </button>
        <span>
          round {snapshot.round?.number}/{snapshot.round?.total} · {live.connectionState}
        </span>
        <span className="flex items-center justify-self-end gap-1">
          {snapshot.phase === "reveal" ? (
            <WordVisibilityControl wordsHidden={wordsHidden} onToggle={toggleWords} />
          ) : null}
          {snapshot.phase === "playing" && !me?.gaveUp ? (
            <GiveUpControl
              tone="dark"
              title="Leave this round?"
              description="Your turns will stop. You can watch the shared ledger until the next word."
              onGiveUp={async () =>
                (
                  await send({
                    type: "round.giveUp",
                    roundId: snapshot.round?.id ?? "",
                  })
                ).accepted
              }
              className="min-h-11 font-mono text-micro theme-faint"
            />
          ) : null}
        </span>
      </header>
      <main id="main" className="heat-game-main mx-auto max-w-2xl px-5">
        <div className="heat-source">
          <HeatGauge
            band={snapshot.round?.exact ? "found" : (hottest?.band ?? "frozen")}
            rank={snapshot.round?.exact ? 0 : (hottest?.rank ?? null)}
            streak={streak.current}
            solved={Boolean(snapshot.round?.exact)}
          />
          <p>
            {hottest ? <span className="heat-source-hottest-word">{hottest.word} · </span> : null}
            {snapshot.phase === "reveal"
              ? snapshot.round?.exact
                ? "found"
                : "closest wins"
              : myTurn
                ? snapshot.round?.openingGuess
                  ? "your free opening spark"
                  : `your turn${seconds === null ? "" : ` · ${seconds}s`}`
                : `${current?.name ?? "someone"} is guessing`}
            {snapshot.phase === "playing" && streak.current >= 3 ? (
              <span className="heat-source-streak"> · streak {streak.current}</span>
            ) : null}
          </p>
        </div>
        {snapshot.phase === "playing" ? (
          <GuessComposer
            disabled={!myTurn || me?.gaveUp}
            message={message}
            receipt={receipt}
            turnLabel={
              myTurn
                ? snapshot.round?.openingGuess
                  ? "free opening guess"
                  : `${snapshot.guessesPerPlayer - (me?.turnsUsed ?? 0)} guesses left`
                : `watching ${current?.name ?? "the room"}`
            }
            onGuess={submitGuess}
            onMessageClear={() => setMessage(null)}
            actions={
              myTurn ? (
                <button
                  type="button"
                  onClick={() =>
                    void send({ type: "turn.pass", roundId: snapshot.round?.id ?? "" })
                  }
                >
                  pass
                </button>
              ) : null
            }
          />
        ) : null}
        <HeatLedger
          guesses={guesses}
          newestId={newest}
          target={snapshot.round?.target}
          wordsHidden={wordsHidden}
        />
        {snapshot.phase === "reveal" ? (
          <section className="pb-36 text-center">
            <h1 className="font-serif text-4xl font-semibold">
              {snapshot.round?.winnerIds
                .map((id) => snapshot.players.find((player) => player.id === id)?.name)
                .filter(Boolean)
                .join(" & ") || "no winner"}
            </h1>
            <p className="mt-2 font-mono text-xs theme-muted">
              {snapshot.round?.exact ? "found the word" : "came closest"}
            </p>
            {snapshot.round ? (
              <HotAndColdResultShare
                id="room-heat-result"
                label={`room ${snapshot.roomId} · round ${snapshot.round.number}/${snapshot.round.total}`}
                guesses={snapshot.round.guesses}
                outcome="round"
              />
            ) : null}
            {snapshot.canControl ? (
              <button
                type="button"
                onClick={() => void send({ type: "round.next" })}
                className="mt-6 min-h-14 rounded-full bg-[var(--things-amber)] px-8 font-mono text-xs font-bold text-black"
              >
                {snapshot.round?.number === snapshot.round?.total ? "finish game" : "next word"}
              </button>
            ) : null}
          </section>
        ) : null}
      </main>
      {snapshot.phase === "reveal" && snapshot.round ? (
        <HotAndColdShareDock
          label={`room ${snapshot.roomId} · round ${snapshot.round.number}/${snapshot.round.total}`}
          guesses={snapshot.round.guesses}
          outcome="round"
          resultId="room-heat-result"
        />
      ) : null}
    </div>
  );
}
