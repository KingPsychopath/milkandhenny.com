import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TextMorph } from "torph/react";
import { AppSelect } from "@/components/AppSelect";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import { PlayerReadyControl } from "../shared/PlayerReadyControl";
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
}: {
  roomId: string;
  connection?: string;
  right?: string;
}) {
  return (
    <header className="twin-header">
      <Link to="/things/twin" className="twin-header-back">
        ← leave
      </Link>
      <span className="twin-header-meta">
        {right ?? `${roomId}${connection ? ` · ${connection}` : ""}`}
      </span>
    </header>
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
  onHandSize,
  colour,
  onColour,
  sound,
  onSound,
}: {
  snapshot: TwinSnapshot;
  playerId: string;
  connection: string;
  message: string | null;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
  onHandSize: (handSize: number) => void;
  colour: boolean;
  onColour: () => void;
  sound: boolean;
  onSound: () => void;
}) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const token =
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem(twinBrowserKeys.invite(snapshot.roomId));
  const invite =
    typeof window === "undefined"
      ? ""
      : buildTwinPlayerInviteUrl(window.location.origin, snapshot.roomId, token ?? undefined);
  const { dataUrl: qr, failed: qrFailed } = useQrCode(invite || null, 280);
  const me = snapshot.players.find(({ id }) => id === playerId);
  const readyCount = snapshot.players.filter(({ ready }) => ready).length;

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
            ? "Use the room code below."
            : null,
    );
  };

  return (
    <div className="things-game things-game--night twin">
      <TwinHeader roomId={snapshot.roomId} connection={connection} />
      <main id="main" className="twin-lobby">
        <p className="twin-eyebrow">room ready</p>
        <h1 className="twin-title">Two cards. One symbol.</h1>
        <p className="twin-lede">
          Every card here shares exactly one symbol with every other. Find yours, put it down, empty
          your hand.
        </p>

        {qr ? (
          <img src={qr} alt="QR code to join this twin room" className="twin-qr" />
        ) : qrFailed ? (
          <p className="twin-note">QR unavailable — share the link or room code.</p>
        ) : null}

        <p className="twin-eyebrow twin-eyebrow--tight">room code</p>
        <p className="twin-code">{snapshot.roomId}</p>
        <button
          type="button"
          onClick={() => void share()}
          className="twin-button twin-button--quiet"
        >
          share invite
        </button>
        <p aria-live="polite" className="twin-message">
          {shareMessage ?? message}
        </p>

        <ul className="twin-roster" aria-label="Players in the room">
          {snapshot.players.map((player) => (
            <li key={player.id} className={player.ready ? "" : "twin-roster-waiting"}>
              {player.name}
              {player.host ? " · host" : ""}
              {player.ready ? "" : " · not ready"}
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="twin-note">
          {readyCount} of {snapshot.players.length} ready · up to {twinMaxPlayers()} can play
        </p>

        {snapshot.canControl ? (
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
            {snapshot.players.length === 1
              ? "start on your own"
              : `start · ${snapshot.players.length} playing`}
          </button>
        ) : (
          <p className="twin-note">waiting for the host to start</p>
        )}
      </main>
    </div>
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
              {player.connected ? "" : " · away"}
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
