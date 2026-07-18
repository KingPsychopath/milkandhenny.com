import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TextMorph } from "torph/react";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import { CountryReveal, CountryRevealLegend, CountryScoreDetails } from "./CountryReveal";
import { countryById } from "./countries";
import { buildDrawCountryPlayerInviteUrl } from "./draw-country-invite";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { resultReaction } from "./result-copy";
import { scoreCountryDrawing } from "./scoring";
import type { CountryDrawing, DrawCountrySnapshot } from "./types";

export function RoomHeader({ roomId, connection }: { roomId: string; connection: string }) {
  return (
    <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/45">
      <Link to="/things/draw-country" className="inline-flex min-h-11 items-center">
        ← leave
      </Link>
      <span>
        {roomId} · {connection}
      </span>
    </header>
  );
}

export function RoomLobby({
  snapshot,
  playerId,
  connection,
  message,
  onReadyChange,
  onStart,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
  connection: string;
  message: string | null;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
}) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const token =
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem(drawCountryBrowserKeys.invite(snapshot.roomId));
  const invite =
    typeof window === "undefined"
      ? ""
      : buildDrawCountryPlayerInviteUrl(
          window.location.origin,
          snapshot.roomId,
          token ?? undefined,
        );
  const { dataUrl: qr, failed: qrFailed } = useQrCode(invite || null, 280);
  const currentPlayer = snapshot.players.find(({ id }) => id === playerId);
  const readyCount = snapshot.players.filter(({ ready }) => ready !== false).length;
  const share = async () => {
    const result = await shareOrCopy(
      { title: "Draw the Country", text: `Join room ${snapshot.roomId}.`, url: invite },
      { copyValue: invite },
    );
    setShareMessage(
      result === "copied"
        ? "Invite copied."
        : result === "shared"
          ? "Invite shared."
          : result === "failed"
            ? "Use the room code below."
            : null,
    );
  };
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader roomId={snapshot.roomId} connection={connection} />
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-5 pb-12 pt-8 text-center"
      >
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">room ready</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">Bring everyone in.</h1>
        <p className="mt-3 max-w-md font-serif text-lg text-black/55">
          You will all draw on your own screen. The closest border wins each round.
        </p>
        {qr ? (
          <img
            src={qr}
            alt="QR code to join the draw the country room"
            className="mt-6 w-48 rounded-3xl bg-white p-3"
          />
        ) : null}
        {qrFailed ? (
          <p className="mt-4 font-mono text-xs text-black/45">
            QR unavailable — share the link or room code.
          </p>
        ) : null}
        <p className="mt-4 font-mono text-micro uppercase tracking-[0.17em] text-black/40">
          room code
        </p>
        <p className="mt-1 font-mono text-2xl tracking-[0.2em]">{snapshot.roomId}</p>
        <button
          type="button"
          onClick={() => void share()}
          className="mt-4 min-h-11 rounded-full border border-black/20 px-6 font-mono text-xs"
        >
          share invite
        </button>
        <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-amber-800">
          {shareMessage ?? message}
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Players in the room">
          {snapshot.players.map((player) => (
            <li
              key={player.id}
              className="rounded-full border border-black/15 bg-white/30 px-4 py-2 font-mono text-sm"
            >
              {player.name} · {player.ready !== false ? "ready" : "not ready"}
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="mt-3 font-mono text-xs text-black/45">
          {readyCount} of {snapshot.players.length} ready
        </p>
        <button
          type="button"
          aria-pressed={currentPlayer?.ready ?? true}
          onClick={() => onReadyChange(!(currentPlayer?.ready ?? true))}
          className="mt-4 min-h-12 rounded-full border border-black/20 px-6 font-mono text-xs font-semibold uppercase tracking-[0.12em]"
        >
          {currentPlayer?.ready ? "ready · tap to wait" : "not ready · tap when ready"}
        </button>
        {snapshot.canControl ? (
          <button
            type="button"
            onClick={onStart}
            className="mt-7 min-h-14 w-full rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
          >
            {snapshot.players.length === 1
              ? "start with just me"
              : `start ${snapshot.players.length}-player game`}
          </button>
        ) : (
          <p className="mt-7 font-mono text-xs text-black/45">waiting for the host to start</p>
        )}
      </main>
    </div>
  );
}

export function RoomReveal({
  snapshot,
  playerId,
  drawing,
  connection,
  onNext,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
  drawing: CountryDrawing;
  connection: string;
  onNext: () => void;
}) {
  const country = countryById(snapshot.round?.countryId ?? "");
  const evaluation = country ? scoreCountryDrawing(country, drawing) : null;
  const me = snapshot.players.find(({ id }) => id === playerId);
  const ranking = snapshot.players.toSorted((a, b) => (b.roundScore ?? 0) - (a.roundScore ?? 0));
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader roomId={snapshot.roomId} connection={connection} />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-12 pt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.16em] text-black/40">
              round {snapshot.round?.number} ·{" "}
              {evaluation
                ? resultReaction(evaluation.score, snapshot.round?.countryId ?? "")
                : "result"}
            </p>
            <h1 className="mt-2 font-serif text-4xl font-semibold sm:text-5xl">
              {snapshot.round?.countryName}
            </h1>
          </div>
          <div className="text-right">
            <TextMorph as="p" className="font-mono text-4xl font-semibold">
              {String(me?.roundScore ?? 0)}
            </TextMorph>
            <p className="font-mono text-micro text-black/40">your points</p>
          </div>
        </div>
        <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(15rem,0.7fr)] sm:items-start">
          {evaluation ? (
            <div>
              <CountryReveal evaluation={evaluation} />
              <CountryScoreDetails evaluation={evaluation} />
              <CountryRevealLegend />
            </div>
          ) : null}
          <section
            aria-labelledby="round-ranking"
            className="rounded-[1.5rem] border border-black/15 bg-white/25 p-4"
          >
            <h2
              id="round-ranking"
              className="font-mono text-micro uppercase tracking-[0.17em] text-black/40"
            >
              closest this round
            </h2>
            <ol className="mt-3 divide-y divide-black/10">
              {ranking.map((player, index) => (
                <li
                  key={player.id}
                  className="flex min-h-11 items-center gap-3 py-2 font-mono text-xs"
                >
                  <span className="w-5 text-black/35">{index + 1}</span>
                  <span className="flex-1 font-semibold">
                    {player.name}
                    {player.id === playerId ? " · you" : ""}
                  </span>
                  <span>{player.roundScore ?? 0}</span>
                </li>
              ))}
            </ol>
            {snapshot.canControl ? (
              <button
                type="button"
                onClick={onNext}
                className="mt-4 min-h-11 w-full rounded-full bg-black px-5 font-mono text-xs text-white"
              >
                next round now
              </button>
            ) : (
              <p className="mt-4 text-center font-mono text-micro text-black/40">
                next round starts automatically
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export function FinalRanking({
  snapshot,
  playerId,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
}) {
  const ranking = snapshot.players.toSorted((a, b) => b.score - a.score);
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader roomId={snapshot.roomId} connection="finished" />
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-16"
      >
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
          final borders
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">The atlas is settled.</h1>
        <ol className="mt-8 divide-y divide-black/10 border-y border-black/15">
          {ranking.map((player, index) => (
            <li key={player.id} className="flex min-h-16 items-center gap-4 py-3">
              <span className="font-mono text-xl text-black/35">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-serif text-xl font-semibold">
                {player.name}
                {player.id === playerId ? " · you" : ""}
              </span>
              <span className="font-mono text-lg font-semibold">{player.score}</span>
            </li>
          ))}
        </ol>
        <Link
          to="/things/draw-country"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
        >
          play again
        </Link>
      </main>
    </div>
  );
}
