import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TextMorph } from "torph/react";
import { AppImage } from "@/components/AppImage";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import { PlayerReadyControl } from "../shared/PlayerReadyControl";
import { GameActionDialog } from "../shared/GameActionDialog";
import { MultiplayerLobbyPanel } from "../shared/PixelWorld";
import { gamePoolRoomInviteUrl } from "../pool/pool-session.client";
import { CountryRevealAnalysis } from "./CountryReveal";
import { DrawCountryResultReport } from "./DrawCountryResultReport";
import { buildDrawCountryPlayerInviteUrl } from "./draw-country-invite";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { resultReaction } from "./result-copy";
import { scoreCountryDrawing } from "./scoring";
import type { CountryDrawing, CountryOutline, DrawCountrySnapshot } from "./types";

export function RoomHeader({
  roomId,
  connection,
  onLeave,
  showReport = true,
}: {
  roomId: string;
  connection: string;
  onLeave?: () => Promise<boolean>;
  showReport?: boolean;
}) {
  const reportConnectionState =
    connection === "connected" || connection === "reconnecting" || connection === "offline"
      ? connection
      : undefined;
  return (
    <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/45">
      <Link to="/things/draw-country" className="inline-flex min-h-11 items-center">
        ← back
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-right">
          {roomId} · {connection}
        </span>
        {showReport ? (
          <ReportIssueButton
            type="things_room_issue"
            payload={{ game: "draw-country", roomId, connectionState: reportConnectionState }}
            label="something feel off?"
            className="mt-0"
          />
        ) : null}
      </div>
      {onLeave ? <DrawCountryLeaveButton onLeave={onLeave} /> : null}
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
  onPassLead,
  onRename,
  startLabel,
  onLeave,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
  connection: string;
  message: string | null;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
  onPassLead: (playerId: string) => void;
  onRename: () => void;
  /** Overrides the start button label, e.g. after nudging unready players. */
  startLabel?: string | null;
  onLeave: () => Promise<boolean>;
}) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const token =
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem(drawCountryBrowserKeys.invite(snapshot.roomId));
  const invite =
    typeof window === "undefined"
      ? ""
      : snapshot.managed
        ? (gamePoolRoomInviteUrl("draw-country", snapshot.roomId) ?? "")
        : buildDrawCountryPlayerInviteUrl(
            window.location.origin,
            snapshot.roomId,
            token ?? undefined,
          );
  const { dataUrl: qr, failed: qrFailed } = useQrCode(invite || null, 280);
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const currentPlayer = snapshot.players.find(({ id }) => id === playerId);
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
            ? snapshot.managed
              ? "Copy the game-night invite link instead."
              : "Use the room code below."
            : null,
    );
  };
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader roomId={snapshot.roomId} connection={connection} onLeave={onLeave} />
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-5 pb-12 pt-8 text-center"
      >
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">room ready</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">Bring everyone in.</h1>
        <p className="mt-3 max-w-md font-serif text-lg text-black/55">
          Everyone draws the same {snapshot.roundTotal} countries. Closest border wins each round.
        </p>
        <p className="mt-2 font-mono text-micro text-black/40">
          {snapshot.roundTotal} rounds · {snapshot.drawSeconds} seconds each · 100 points per round
        </p>
        <MultiplayerLobbyPanel
          canPassLead={snapshot.canControl && snapshot.players.length > 1}
          currentPlayerId={playerId}
          game="draw-country"
          onPassLead={onPassLead}
          onRename={onRename}
          roomId={snapshot.roomId}
          players={snapshot.players.map((player) => ({
            id: player.id,
            name: player.name,
            ready: player.ready,
            lead: player.id === snapshot.hostPlayerId,
            left: player.withdrawn,
          }))}
        />
        {invite ? (
          <>
            {qr ? (
              <AppImage
                src={qr}
                alt="QR code to join the draw the country room"
                width={280}
                height={280}
                className="mt-6 w-48 rounded-3xl bg-white p-3"
              />
            ) : null}
            {qrFailed ? (
              <p className="mt-4 font-mono text-xs text-black/45">
                {snapshot.managed
                  ? "QR unavailable — copy the game-night invite link."
                  : "QR unavailable — share the link or room code."}
              </p>
            ) : null}
            <p className="mt-4 font-mono text-micro uppercase tracking-[0.17em] text-black/40">
              {snapshot.managed ? "invite link" : "room code"}
            </p>
            <p className="mt-1 font-mono text-2xl tracking-[0.2em]">{snapshot.roomId}</p>
            <button
              type="button"
              onClick={() => void share()}
              className="mt-4 min-h-11 rounded-full border border-black/20 px-6 font-mono text-xs"
            >
              {nativeShare ? "share invite" : "copy invite link"}
            </button>
          </>
        ) : null}
        <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-amber-800">
          {shareMessage ?? message}
        </p>
        <PlayerReadyControl
          ready={currentPlayer?.ready ?? true}
          onChange={onReadyChange}
          tone="light"
          readyHint="You’re all set — wait here for the host to start drawing."
        />
        {snapshot.canControl ? (
          <button
            type="button"
            onClick={onStart}
            className="mt-7 min-h-14 w-full rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
          >
            {startLabel ??
              (snapshot.players.length === 1
                ? "start with just me"
                : `start ${snapshot.players.length}-player game`)}
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
  country,
  connection,
  onNext,
  onLeave,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
  drawing: CountryDrawing;
  country: CountryOutline | null;
  connection: string;
  onNext: () => void;
  onLeave: () => Promise<boolean>;
}) {
  const evaluation = country ? scoreCountryDrawing(country, drawing) : null;
  const me = snapshot.players.find(({ id }) => id === playerId);
  const ranking = snapshot.players.toSorted((a, b) => (b.roundScore ?? 0) - (a.roundScore ?? 0));
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader
        roomId={snapshot.roomId}
        connection={connection}
        onLeave={onLeave}
        showReport={false}
      />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-12 pt-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-micro uppercase tracking-[0.16em] text-black/40">
              round {snapshot.round?.number} ·{" "}
              {evaluation
                ? resultReaction(evaluation.score, snapshot.round?.countryId ?? "")
                : "result"}
            </p>
            <h1 className="mt-2 break-words font-serif text-4xl font-semibold sm:text-5xl">
              {snapshot.round?.countryName}
            </h1>
          </div>
          <p className="sr-only">Your score this round is {me?.roundScore ?? 0}</p>
          <div className="shrink-0 text-right" aria-hidden="true">
            <TextMorph as="p" className="font-mono text-4xl font-semibold">
              {String(me?.roundScore ?? 0)}
            </TextMorph>
            <p className="font-mono text-micro text-black/40">your points</p>
          </div>
        </div>
        <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(15rem,0.7fr)] sm:items-start">
          {evaluation ? (
            <div>
              <CountryRevealAnalysis evaluation={evaluation} />
              <DrawCountryResultReport
                countryId={snapshot.round?.countryId ?? ""}
                drawing={drawing}
                mode="multiplayer"
              />
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
              round {snapshot.round?.number} of {snapshot.roundTotal}
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
                    {player.id === playerId ? " · you" : player.withdrawn ? " · left" : ""}
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold">{player.roundScore ?? 0}</span>
                    <span className="block text-micro text-black/35">{player.score} total</span>
                  </span>
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
  message,
  pending,
  onPlayAgain,
  onBackToLobby,
  onLeave,
}: {
  snapshot: DrawCountrySnapshot;
  playerId: string;
  message: string | null;
  pending: boolean;
  onPlayAgain: () => void;
  onBackToLobby: () => void;
  onLeave: () => Promise<boolean>;
}) {
  const ranking = snapshot.players.toSorted((a, b) => b.score - a.score);
  const session = snapshot.gameNumber > 1;
  return (
    <div className="things-game things-game--cream text-black">
      <RoomHeader roomId={snapshot.roomId} connection="finished" onLeave={onLeave} />
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-16"
      >
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
          {session ? `game ${snapshot.gameNumber} · final borders` : "final borders"}
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">Final scores.</h1>
        <p className="mt-3 font-serif text-black/55">
          {snapshot.roundTotal} countries · {snapshot.roundTotal * 100} points available
        </p>
        <ol className="mt-8 divide-y divide-black/10 border-y border-black/15">
          {ranking.map((player, index) => (
            <li key={player.id} className="flex min-h-16 items-center gap-4 py-3">
              <span className="font-mono text-xl text-black/35">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-serif text-xl font-semibold">
                {player.name}
                {player.id === playerId ? " · you" : player.withdrawn ? " · left" : ""}
              </span>
              <span className="text-right">
                <span className="block font-mono text-lg font-semibold">{player.score}</span>
                <span className="block font-mono text-micro text-black/40">
                  {Math.round(player.score / snapshot.roundTotal)} average
                </span>
                {session ? (
                  <span className="block font-mono text-micro text-black/40">
                    {player.sessionScore} total
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        {snapshot.canControl ? (
          <>
            <button
              type="button"
              onClick={onPlayAgain}
              disabled={pending}
              className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40"
            >
              {pending ? "dealing new countries…" : "play again · same people"}
            </button>
            <button
              type="button"
              onClick={onBackToLobby}
              disabled={pending}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-black/20 px-6 font-mono text-xs disabled:opacity-40"
            >
              back to the lobby to add people
            </button>
          </>
        ) : (
          <p aria-live="polite" className="mt-8 text-center font-mono text-xs text-black/45">
            waiting for the host to start another game
          </p>
        )}
        <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-800">
          {message}
        </p>
        <Link
          to="/things/draw-country"
          className="mt-6 inline-flex min-h-11 items-center justify-center font-mono text-xs text-black/45"
        >
          leave the room
        </Link>
      </main>
    </div>
  );
}

function DrawCountryLeaveButton({ onLeave }: { onLeave: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        type="button"
        className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        leave room
      </button>
      {open ? (
        <GameActionDialog
          tone="light"
          eyebrow="leave room"
          title="Leave this room?"
          description="You will give up your seat. If you are the host, the oldest connected player will take over."
          cancelLabel="stay"
          confirmLabel="leave room"
          pending={pending}
          pendingLabel="leaving…"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setPending(true);
            void onLeave().then((left) => {
              setPending(false);
              if (left) setOpen(false);
            });
          }}
        />
      ) : null}
    </>
  );
}
