import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { AppImage } from "@/components/AppImage";
import { useQrCode } from "@/hooks/useQrCode";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { GiveUpControl } from "../shared/GiveUpControl";
import { PlayerReadyControl } from "../shared/PlayerReadyControl";
import { applyHotAndColdActionFn, joinHotAndColdRoomFn } from "./hot-and-cold.functions";
import { buildHotAndColdInviteUrl, parseHotAndColdInviteFragment } from "./hot-and-cold-invite";
import { HeatLedger } from "./HeatLedger";
import { GuessComposer } from "./GuessComposer";
import { HotAndColdResultShare } from "./HotAndColdResultShare";
import { useHotAndColdRoom } from "./useHotAndColdRoom";
import type { HotAndColdAction, HotAndColdCredentials } from "./types";
import type { MultiplayerActionInput } from "../shared/multiplayer";

export function JoinHotAndColdRoom({
  roomId,
  onJoined,
}: {
  roomId: string;
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
          joinToken: parseHotAndColdInviteFragment(location.hash) || undefined,
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
        <label className="mt-9 block font-mono text-xs theme-muted">
          <span className="block pb-2">your name</span>
          <input
            autoFocus={loaded && !name}
            value={name}
            maxLength={24}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            className="min-h-14 w-full border-b theme-border bg-transparent font-serif text-3xl outline-none"
          />
        </label>
        <button
          type="button"
          disabled={!name.trim() || joining}
          onClick={() => void join()}
          className="mt-9 min-h-16 rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black disabled:opacity-40"
        >
          {joining ? "joining…" : "join room"}
        </button>
        {message ? (
          <p role="alert" className="mt-4 font-mono text-xs text-[var(--things-amber)]">
            {message}
          </p>
        ) : null}
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
  const snapshot = live.snapshot;
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
    if (guess && guess.playerId === credentials.playerId)
      void haptics.trigger(
        guess.rank === 0 ? "success" : guess.rank < 500 ? "warning" : "selection",
      );
  }, [credentials.playerId, haptics, latestId, snapshot?.round?.guesses]);
  const send = async (action: MultiplayerActionInput<HotAndColdAction>) => {
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
      if (!result.accepted) setMessage(result.error);
      return result.accepted;
    } catch {
      setMessage("Could not reach the room");
      return false;
    }
  };
  const leave = async () => {
    await send({ type: "player.leave" });
    onLeave();
  };
  if (!snapshot)
    return (
      <div className="hot-and-cold grid min-h-svh place-items-center font-mono text-xs">
        {live.message ?? "warming the room…"}
      </div>
    );
  const me = snapshot.players.find(({ id }) => id === credentials.playerId);
  const current = snapshot.players.find(({ id }) => id === snapshot.round?.currentPlayerId);
  const myTurn = snapshot.phase === "playing" && current?.id === credentials.playerId;
  const guesses = (snapshot.round?.guesses ?? []).map((guess) => ({
    ...guess,
    mine: guess.playerId === credentials.playerId,
  }));
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
                <select
                  name="turn-seconds"
                  disabled={!snapshot.canControl || snapshot.managed}
                  value={snapshot.turnSeconds}
                  onChange={(event) =>
                    void send({ type: "game.configure", turnSeconds: Number(event.target.value) })
                  }
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-2"
                >
                  {[10, 15, 20, 30, 0].map((value) => (
                    <option key={value} value={value}>
                      {value || "∞"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          {snapshot.canControl ? (
            <button
              type="button"
              onClick={() => void send({ type: "game.start" })}
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
    <div className="hot-and-cold min-h-svh">
      <header className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-5 pt-3 font-mono text-xs theme-muted">
        <button type="button" className="min-h-11" onClick={() => void leave()}>
          ← leave
        </button>
        <span>
          round {snapshot.round?.number}/{snapshot.round?.total} · {live.connectionState}
        </span>
        {snapshot.phase === "playing" && !me?.gaveUp ? (
          <GiveUpControl
            tone="dark"
            title="Leave this round?"
            description="Your turns will stop. You can watch the shared ledger until the next word."
            onGiveUp={() => send({ type: "round.giveUp", roundId: snapshot.round?.id ?? "" })}
            className="min-h-11 justify-self-end font-mono text-micro theme-faint"
          />
        ) : (
          <span />
        )}
      </header>
      <main id="main" className="mx-auto max-w-2xl px-5">
        <div className="heat-source">
          <div className="heat-source-flame" aria-hidden="true">
            {snapshot.phase === "reveal" ? "✦" : "♨"}
          </div>
          <p>
            {snapshot.phase === "reveal"
              ? snapshot.round?.exact
                ? "found"
                : "closest wins"
              : myTurn
                ? snapshot.round?.openingGuess
                  ? "your free opening spark"
                  : `your turn${seconds === null ? "" : ` · ${seconds}s`}`
                : `${current?.name ?? "someone"} is guessing`}
          </p>
        </div>
        <HeatLedger guesses={guesses} newestId={newest} target={snapshot.round?.target} />
        {snapshot.phase === "reveal" ? (
          <section className="pb-24 text-center">
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
                label={`room ${snapshot.roomId} · round ${snapshot.round.number}/${snapshot.round.total}`}
                guesses={snapshot.round.guesses}
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
      {snapshot.phase === "playing" ? (
        <>
          <GuessComposer
            disabled={!myTurn || me?.gaveUp}
            message={message}
            turnLabel={
              myTurn
                ? snapshot.round?.openingGuess
                  ? "free opening guess"
                  : `${snapshot.guessesPerPlayer - (me?.turnsUsed ?? 0)} guesses left`
                : `watching ${current?.name ?? "the room"}`
            }
            onGuess={(word) =>
              send({ type: "guess.submit", word, roundId: snapshot.round?.id ?? "" })
            }
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
        </>
      ) : null}
    </div>
  );
}
