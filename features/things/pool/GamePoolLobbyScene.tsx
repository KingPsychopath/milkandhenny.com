import type { ReactNode } from "react";

import { buildGamePoolLobbyScene, gamePoolLobbyStatus } from "./lobby-scene";
import type { GamePoolRoomSummary } from "./types";
import "./GamePoolLobbyScene.css";

interface PixelPersonProps {
  className?: string;
  label?: string;
  tone: number;
}

function PixelPerson({ className = "", label, tone }: PixelPersonProps) {
  return (
    <span className={`game-pool-pixel-person game-pool-pixel-tone-${tone} ${className}`}>
      <span className="game-pool-pixel-shadow" />
      <span className="game-pool-pixel-hair" />
      <span className="game-pool-pixel-head" />
      <span className="game-pool-pixel-body" />
      <span className="game-pool-pixel-arm game-pool-pixel-arm-left" />
      <span className="game-pool-pixel-arm game-pool-pixel-arm-right" />
      <span className="game-pool-pixel-leg game-pool-pixel-leg-left" />
      <span className="game-pool-pixel-leg game-pool-pixel-leg-right" />
      {label ? <span className="game-pool-pixel-label">{label}</span> : null}
    </span>
  );
}

function LobbyRoom({
  children,
  capacity,
  count,
  highlighted,
  label,
  placeholder = false,
  slot,
  status,
}: {
  children?: ReactNode;
  capacity: number;
  count: number;
  highlighted: boolean;
  label: string;
  placeholder?: boolean;
  slot: number;
  status: GamePoolRoomSummary["status"];
}) {
  const stateClass = placeholder
    ? "game-pool-lobby-room-placeholder"
    : status === "started"
      ? "game-pool-lobby-room-playing"
      : "game-pool-lobby-room-waiting";
  return (
    <div
      className={`game-pool-lobby-room game-pool-lobby-room-${slot} ${stateClass}${highlighted ? " game-pool-lobby-room-highlighted" : ""}`}
    >
      <div className="game-pool-lobby-room-sign">
        <span>{label}</span>
        <span>{placeholder ? "next" : `${count}/${capacity}`}</span>
      </div>
      <div className="game-pool-lobby-room-window">
        <span className="game-pool-lobby-window-light" />
      </div>
      <div className="game-pool-lobby-room-floor">
        <span className="game-pool-lobby-table" />
        {Array.from({ length: Math.min(capacity, 6) }, (_, index) => (
          <span key={index} className={`game-pool-lobby-chair game-pool-lobby-chair-${index}`} />
        ))}
        {children}
      </div>
      <div className="game-pool-lobby-room-door">
        <span>{placeholder ? "soon" : status === "started" ? "playing" : "waiting"}</span>
      </div>
    </div>
  );
}

export function GamePoolLobbyScene({
  allowNewRooms,
  destinationRoomId,
  joining,
  live,
  requestedRoomId,
  rooms,
  targetSize,
}: {
  allowNewRooms: boolean;
  destinationRoomId: string | null;
  joining: boolean;
  live: boolean;
  requestedRoomId?: string;
  rooms: GamePoolRoomSummary[];
  targetSize: number;
}) {
  const scene = buildGamePoolLobbyScene(rooms, destinationRoomId ?? requestedRoomId);
  const placeholderSlot =
    allowNewRooms && scene.rooms.length < 3
      ? scene.rooms.length
      : scene.rooms.length === 0
        ? 0
        : null;
  const destinationIndex = scene.rooms.findIndex(({ roomId }) => roomId === destinationRoomId);
  const destinationSlot = destinationIndex >= 0 ? destinationIndex : placeholderSlot;
  const status = gamePoolLobbyStatus({
    destinationRoomId,
    joining,
    rooms: scene.rooms,
    waitingPlayerCount: scene.waitingPlayerCount,
    waitingRoomCount: scene.waitingRoomCount,
  });

  return (
    <section className="game-pool-lobby" aria-labelledby="game-pool-lobby-title">
      <div className="game-pool-lobby-heading">
        <div>
          <h2 id="game-pool-lobby-title" className="font-mono text-xs font-medium">
            the lobby
          </h2>
          <p className="mt-1 font-mono text-micro theme-muted" aria-live="polite">
            {status}
          </p>
        </div>
        <span className="game-pool-lobby-live" aria-hidden="true">
          <span /> {live ? "live" : "refreshing"}
        </span>
      </div>

      <div className="game-pool-lobby-stage" aria-hidden="true">
        <div className="game-pool-lobby-wall-lines" />
        <div className="game-pool-lobby-hotel-sign">
          <span>game</span>
          <strong>night</strong>
        </div>
        <div className="game-pool-lobby-entrance">
          <span className="game-pool-lobby-entrance-awning" />
          <span className="game-pool-lobby-entrance-door" />
          <small>lobby</small>
        </div>
        <div className="game-pool-lobby-desk">
          <span className="game-pool-lobby-desk-lamp" />
          <span className="game-pool-lobby-desk-top" />
          <span className="game-pool-lobby-desk-front">rooms</span>
        </div>
        <PixelPerson className="game-pool-lobby-host" tone={4} />

        {scene.rooms.map((room, slot) => (
          <LobbyRoom
            key={room.roomId}
            capacity={room.capacity}
            count={room.playerCount}
            highlighted={requestedRoomId === room.roomId || destinationRoomId === room.roomId}
            label={room.label}
            slot={slot}
            status={room.status}
          >
            {room.actors.map((actor) => (
              <PixelPerson
                key={actor.id}
                className={`game-pool-lobby-occupant game-pool-lobby-seat-${actor.seat}`}
                label={actor.label}
                tone={actor.tone}
              />
            ))}
            {room.hiddenCount > 0 ? (
              <span className="game-pool-lobby-more">+{room.hiddenCount}</span>
            ) : null}
          </LobbyRoom>
        ))}

        {placeholderSlot !== null ? (
          <LobbyRoom
            capacity={targetSize}
            count={0}
            highlighted={Boolean(destinationRoomId && destinationIndex < 0)}
            label="next room"
            placeholder
            slot={placeholderSlot}
            status="open"
          />
        ) : null}

        {scene.hiddenRoomCount > 0 ? (
          <span className="game-pool-lobby-room-overflow">+{scene.hiddenRoomCount} more</span>
        ) : null}

        {joining ? (
          <PixelPerson
            className={`game-pool-lobby-you ${destinationRoomId && destinationSlot !== null ? `game-pool-lobby-you-room-${destinationSlot}` : "game-pool-lobby-you-matching"}`}
            label="you"
            tone={2}
          />
        ) : null}
      </div>

      <p className="sr-only">
        {scene.rooms.length === 0
          ? "No rooms are waiting yet. Matchmaking can create the next room."
          : `${scene.waitingPlayerCount} ${scene.waitingPlayerCount === 1 ? "player is" : "players are"} waiting. ${scene.playingRoomCount} ${scene.playingRoomCount === 1 ? "room is" : "rooms are"} playing.`}
      </p>
    </section>
  );
}
