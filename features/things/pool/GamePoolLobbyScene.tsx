import { useEffect, useMemo, useRef, useState } from "react";

import { PixelWorld } from "../shared/PixelWorld";
import type { PixelWorldGame, PixelWorldPlayer } from "../shared/pixel-world";
import { buildGamePoolLobbyScene, gamePoolLobbyStatus } from "./lobby-scene";
import type { GamePoolRoomSummary } from "./types";
import "./GamePoolLobbyScene.css";

const ROOMS_PER_FLOOR = 3;

export function GamePoolLobbyScene({
  allowNewRooms,
  allowRoomChoice,
  busy,
  destinationRoomId,
  game,
  joining,
  live,
  onChooseRoom,
  requestedRoomId,
  rooms,
  targetSize,
}: {
  allowNewRooms: boolean;
  allowRoomChoice: boolean;
  busy: boolean;
  destinationRoomId: string | null;
  game: PixelWorldGame;
  joining: boolean;
  live: boolean;
  onChooseRoom: (roomId: string) => void;
  requestedRoomId?: string;
  rooms: GamePoolRoomSummary[];
  targetSize: number;
}) {
  const priorityRoomId = destinationRoomId ?? requestedRoomId;
  const scene = useMemo(
    () => buildGamePoolLobbyScene(rooms, priorityRoomId),
    [priorityRoomId, rooms],
  );
  const floors = useMemo(() => {
    const next = scene.floors.map((floor) => [...floor]);
    if (next.length === 0) return [[]];
    if (!allowNewRooms) return next;
    if ((next.at(-1)?.length ?? 0) >= ROOMS_PER_FLOOR) next.push([]);
    return next;
  }, [allowNewRooms, scene.floors]);
  const [floorIndex, setFloorIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const status = gamePoolLobbyStatus({
    destinationRoomId,
    joining,
    rooms: scene.rooms,
    waitingPlayerCount: scene.waitingPlayerCount,
    waitingRoomCount: scene.waitingRoomCount,
  });

  useEffect(() => {
    setFloorIndex(0);
    scrollerRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [priorityRoomId]);

  const goToFloor = (index: number) => {
    const next = Math.max(0, Math.min(floors.length - 1, index));
    const scroller = scrollerRef.current;
    setFloorIndex(next);
    if (scroller) scroller.scrollTo({ left: next * scroller.clientWidth, behavior: "smooth" });
  };

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
        <span className="game-pool-lobby-live" aria-label={live ? "live" : "refreshing"}>
          <span aria-hidden="true" /> {live ? "live" : "refreshing"}
        </span>
      </div>

      <div className="game-pool-hotel">
        <div className="game-pool-hotel-sign" aria-hidden="true">
          <span>game night hotel</span>
          <small>rooms fill from the lobby</small>
        </div>
        <div
          ref={scrollerRef}
          className="game-pool-hotel-floors"
          onScroll={(event) => {
            const target = event.currentTarget;
            if (target.clientWidth > 0)
              setFloorIndex(Math.round(target.scrollLeft / target.clientWidth));
          }}
        >
          {floors.map((floor, index) => (
            <div
              key={`floor-${index}`}
              className="game-pool-hotel-floor"
              aria-label={`Floor ${index + 1} of ${floors.length}`}
            >
              <div className="game-pool-hotel-corridor" aria-hidden="true">
                <span>floor {index + 1}</span>
              </div>
              <div className="game-pool-hotel-rooms">
                {floor.map((room) => {
                  const choosing = allowRoomChoice && room.status === "open";
                  const highlighted = priorityRoomId === room.roomId;
                  const players: PixelWorldPlayer[] = room.actors.map((actor) => ({
                    id: actor.id,
                    name: actor.label,
                    ready: true,
                  }));
                  if (destinationRoomId === room.roomId)
                    players.push({
                      id: "current-player",
                      name: "you",
                      ready: false,
                      entering: true,
                    });
                  const sceneCard = (
                    <>
                      <span className="game-pool-hotel-room-heading">
                        <span>{room.label}</span>
                        <span>
                          {room.playerCount}/{room.capacity}
                        </span>
                      </span>
                      <PixelWorld
                        className="game-pool-hotel-room-scene"
                        room={{
                          game,
                          roomId: room.roomId,
                          status: room.status === "started" ? "playing" : "waiting",
                          players,
                          capacity: room.capacity,
                        }}
                        label={`${room.label}: ${room.playerCount} of ${room.capacity}, ${room.status === "started" ? "playing" : "waiting"}`}
                      />
                      {room.actors.some(({ label }) => label) ? (
                        <span className="game-pool-hotel-room-people">
                          {room.actors
                            .map(({ label }) => label)
                            .filter(Boolean)
                            .join(", ")}
                          {room.hiddenCount > 0 ? ` +${room.hiddenCount}` : ""}
                        </span>
                      ) : null}
                      <span className="game-pool-hotel-room-state">
                        {room.status === "started"
                          ? "playing"
                          : highlighted
                            ? "your room"
                            : choosing
                              ? "tap to join"
                              : "waiting"}
                      </span>
                    </>
                  );
                  return choosing ? (
                    <button
                      key={room.roomId}
                      type="button"
                      disabled={busy}
                      className={`game-pool-hotel-room game-pool-hotel-room-button${highlighted ? " game-pool-hotel-room-highlighted" : ""}`}
                      onClick={() => onChooseRoom(room.roomId)}
                    >
                      {sceneCard}
                    </button>
                  ) : (
                    <div
                      key={room.roomId}
                      className={`game-pool-hotel-room${highlighted ? " game-pool-hotel-room-highlighted" : ""}`}
                    >
                      {sceneCard}
                    </div>
                  );
                })}
                {scene.rooms.length === 0 ? (
                  <div className="game-pool-hotel-room game-pool-hotel-room-next">
                    <span className="game-pool-hotel-room-heading">
                      <span>getting ready</span>
                      <span>0/{targetSize}</span>
                    </span>
                    <PixelWorld
                      className="game-pool-hotel-room-scene"
                      decorative
                      room={{
                        game,
                        roomId: `arranging-${game}`,
                        status: "next",
                        players: [
                          {
                            id: `arranger-${game}`,
                            name: "room arranger",
                            ready: false,
                            role: "arranger",
                          },
                        ],
                        capacity: targetSize,
                      }}
                      label=""
                    />
                    <span className="game-pool-hotel-room-state">arranging chairs</span>
                  </div>
                ) : allowNewRooms && index === floors.length - 1 ? (
                  <div className="game-pool-hotel-room game-pool-hotel-room-next">
                    <span className="game-pool-hotel-room-heading">
                      <span>next room</span>
                      <span>0/{targetSize}</span>
                    </span>
                    <PixelWorld
                      className="game-pool-hotel-room-scene"
                      decorative
                      room={{
                        game,
                        roomId: `next-${game}`,
                        status: "next",
                        players: [],
                        capacity: targetSize,
                      }}
                      label="The next room is ready to open"
                    />
                    <span className="game-pool-hotel-room-state">ready to open</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {floors.length > 1 ? (
          <div className="game-pool-hotel-navigation">
            <button
              type="button"
              disabled={floorIndex === 0}
              onClick={() => goToFloor(floorIndex - 1)}
              aria-label="Previous lobby floor"
            >
              ←
            </button>
            <div
              className="game-pool-hotel-dots"
              aria-label={`Floor ${floorIndex + 1} of ${floors.length}`}
            >
              {floors.map((_floor, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Show lobby floor ${index + 1}`}
                  aria-current={index === floorIndex ? "true" : undefined}
                  onClick={() => goToFloor(index)}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={floorIndex === floors.length - 1}
              onClick={() => goToFloor(floorIndex + 1)}
              aria-label="Next lobby floor"
            >
              →
            </button>
          </div>
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
