import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TextMorph } from "torph/react";
import { AppSelect } from "@/components/AppSelect";
import { AppImage } from "@/components/AppImage";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import { PlayerReadyControl } from "../shared/PlayerReadyControl";
import { GameActionDialog } from "../shared/GameActionDialog";
import { MultiplayerLobbyPanel } from "../shared/PixelWorld";
import { ThingsRoomHeader } from "../shared/RoomHeader";
import type { MultiplayerConnectionState } from "../shared/multiplayer";
import { gamePoolRoomInviteUrl } from "../pool/pool-session.client";
import {
  TWIN_MAX_HAND,
  TWIN_MIN_HAND,
  twinDeckCapacity,
  twinMaxPlayers,
  twinSymbolsPerCard,
} from "./twin-deck";
import { buildTwinPlayerInviteUrl } from "./twin-invite";
import { twinBrowserKeys } from "./twin-keys";
import type { TwinSnapshot } from "./types";

export function TwinHeader({
  roomId,
  connection,
  right,
  onLeave,
}: {
  roomId: string;
  connection?: MultiplayerConnectionState;
  right?: string;
  onLeave?: () => Promise<boolean>;
}) {
  return (
    <ThingsRoomHeader
      tone="night"
      back={
        <Link to="/things/twin" className="twin-header-back">
          ← twin
        </Link>
      }
      roomId={roomId}
      connection={connection}
      detail={right}
      right={onLeave ? <TwinLeaveButton onLeave={onLeave} /> : <span aria-hidden="true" />}
    />
  );
}

/** The deck the table has landed on. Derived, never chosen — so the lobby explains it. */
export function TwinDeckLine({ snapshot }: { snapshot: TwinSnapshot }) {
  return (
    <p className="twin-deck-line">
      {twinDeckCapacity(snapshot.order)} cards · {twinSymbolsPerCard(snapshot.order)} symbols each ·{" "}
      {snapshot.handSize} in hand
    </p>
  );
}

export function TwinLobby({
  snapshot,
  playerId,
  connection,
  message,
  onReadyChange,
  onStart,
  onPassLead,
  onRename,
  startLabel,
  onHandSize,
  colour,
  onColour,
  sound,
  onSound,
  onLeave,
}: {
  snapshot: TwinSnapshot;
  playerId: string;
  connection: MultiplayerConnectionState;
  message: string | null;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
  onPassLead: (playerId: string) => void;
  onRename: () => void;
  /** Overrides the start button label, e.g. after nudging unready players. */
  startLabel?: string | null;
  onHandSize: (handSize: number) => void;
  colour: boolean;
  onColour: () => void;
  sound: boolean;
  onSound: () => void;
  onLeave: () => Promise<boolean>;
}) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const token =
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem(twinBrowserKeys.invite(snapshot.roomId));
  const invite =
    typeof window === "undefined"
      ? ""
      : snapshot.managed
        ? (gamePoolRoomInviteUrl("twin", snapshot.roomId) ?? "")
        : buildTwinPlayerInviteUrl(window.location.origin, snapshot.roomId, token ?? undefined);
  const { dataUrl: qr, failed: qrFailed } = useQrCode(invite || null, 280);
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const me = snapshot.players.find(({ id }) => id === playerId);

  const share = async () => {
    const result = await shareOrCopy(
      { title: "Twin", text: `Join room ${snapshot.roomId}.`, url: invite },
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
    <div className="things-game things-game--night twin">
      <TwinHeader roomId={snapshot.roomId} connection={connection} onLeave={onLeave} />
      <main id="main" className="twin-lobby">
        <h1 className="twin-title">Find the shared symbol.</h1>
        <p className="twin-lede">
          Share the code, choose how many cards each player starts with, then tap ready. The host
          deals when everyone is in.
        </p>

        <MultiplayerLobbyPanel
          canPassLead={snapshot.canControl && snapshot.players.length > 1}
          currentPlayerId={playerId}
          game="twin"
          onPassLead={onPassLead}
          onRename={onRename}
          roomId={snapshot.roomId}
          tone="night"
          players={snapshot.players.map((player) => ({
            id: player.id,
            name: player.name,
            ready: player.ready,
            lead: player.host,
            left: player.withdrawn,
          }))}
        />

        {invite ? (
          <>
            {qr ? (
              <AppImage
                src={qr}
                alt="QR code to join this twin room"
                width={280}
                height={280}
                className="twin-qr"
              />
            ) : qrFailed ? (
              <p className="twin-note">
                {snapshot.managed
                  ? "QR unavailable — copy the game-night invite link."
                  : "QR unavailable — share the link or room code."}
              </p>
            ) : null}

            <p className="twin-eyebrow twin-eyebrow--tight">
              {snapshot.managed ? "invite link" : "room code"}
            </p>
            <p className="twin-code">{snapshot.roomId}</p>
            <button
              type="button"
              onClick={() => void share()}
              className="twin-button twin-button--quiet"
            >
              {nativeShare ? "share invite" : "copy invite link"}
            </button>
          </>
        ) : null}
        <p aria-live="polite" className="twin-message">
          {shareMessage ?? message}
        </p>

        <p aria-live="polite" className="twin-note">
          up to {twinMaxPlayers()} can play
        </p>

        {snapshot.canControl && !snapshot.managed ? (
          <label className="twin-field">
            <span>cards each</span>
            <AppSelect
              value={snapshot.handSize}
              onValueChange={(value) => onHandSize(Number(value))}
              ariaLabel="Cards each"
              tone="night"
              className="twin-select"
              options={Array.from(
                { length: TWIN_MAX_HAND - TWIN_MIN_HAND + 1 },
                (_unused, index) => {
                  const value = TWIN_MIN_HAND + index;
                  return { value, label: String(value) };
                },
              )}
            />
          </label>
        ) : null}
        <TwinDeckLine snapshot={snapshot} />

        {/* Device preferences, not room ones — everyone picks how their own game looks and sounds. */}
        <div className="twin-toggles">
          <button type="button" aria-pressed={colour} onClick={onColour} className="twin-toggle">
            {colour ? "colour" : "ink only"}
          </button>
          <button type="button" aria-pressed={sound} onClick={onSound} className="twin-toggle">
            {sound ? "sound" : "muted"}
          </button>
        </div>

        <PlayerReadyControl
          ready={me?.ready ?? true}
          onChange={onReadyChange}
          readyHint="You’re all set — wait here for the host to deal."
        />

        {snapshot.canControl ? (
          <button type="button" onClick={onStart} className="twin-button twin-button--go">
            {startLabel ??
              (snapshot.players.length === 1
                ? "start on your own"
                : `start · ${snapshot.players.length} playing`)}
          </button>
        ) : (
          <p className="twin-note">waiting for the host to start</p>
        )}
      </main>
    </div>
  );
}

function TwinLeaveButton({ onLeave }: { onLeave: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        type="button"
        className="things-room-header-cta"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        leave room
      </button>
      {open ? (
        <GameActionDialog
          tone="dark"
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

/** What happened in the heat that just closed. Everyone's result, in the order they found it. */
export function TwinSettle({ snapshot, playerId }: { snapshot: TwinSnapshot; playerId: string }) {
  const heat = snapshot.heat;
  if (!heat || heat.results.length === 0) return null;
  const landed = heat.results.filter(({ elapsedMs }) => elapsedMs !== null);
  const ranked = landed.toSorted((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));
  const missed = heat.results.filter(({ elapsedMs }) => elapsedMs === null);

  return (
    <section className="twin-settle" aria-label={`Heat ${heat.number} result`}>
      {heat.burned ? (
        <p className="twin-settle-burn">nobody found it · every hand turns over</p>
      ) : (
        <ol className="twin-settle-list">
          {ranked.map((result, index) => (
            <li
              key={result.playerId}
              className={result.won ? "twin-settle-won" : ""}
              data-you={result.playerId === playerId ? "true" : "false"}
              // Staggered in finishing order, so the list reads as a photo finish rather than a table.
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span className="twin-settle-place">{index + 1}</span>
              <span className="twin-settle-name">
                {result.name}
                {result.playerId === playerId ? " · you" : ""}
              </span>
              <span className="twin-settle-time">
                {((result.elapsedMs ?? 0) / 1_000).toFixed(2)}s
              </span>
            </li>
          ))}
        </ol>
      )}
      {missed.length > 0 && !heat.burned ? (
        <p className="twin-settle-missed">missed by {missed.map(({ name }) => name).join(", ")}</p>
      ) : null}
    </section>
  );
}

/** Cards left, per player, always visible outside a live heat. */
export function TwinStandings({
  snapshot,
  playerId,
}: {
  snapshot: TwinSnapshot;
  playerId: string;
}) {
  return (
    <ul className="twin-standings" aria-label="Cards left">
      {snapshot.players
        .toSorted((a, b) => a.cardsLeft - b.cardsLeft)
        .map((player) => (
          <li key={player.id} data-you={player.id === playerId ? "true" : "false"}>
            <span className="twin-standings-name">
              {player.name}
              {player.withdrawn ? " · left" : player.connected ? "" : " · away"}
            </span>
            <span className="twin-standings-chain">
              {player.chain > 1 ? `×${player.chain}` : ""}
            </span>
            <TextMorph as="span" className="twin-standings-count">
              {String(player.cardsLeft)}
            </TextMorph>
          </li>
        ))}
    </ul>
  );
}
