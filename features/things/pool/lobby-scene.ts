import type { GamePoolPublicOccupant, GamePoolRoomSummary } from "./types";

export const GAME_POOL_LOBBY_ROOM_LIMIT = 3;
export const GAME_POOL_LOBBY_OCCUPANT_LIMIT = 6;

export interface GamePoolLobbyActor {
  id: string;
  label?: string;
  seat: number;
  tone: number;
}

export interface GamePoolLobbyRoom {
  roomId: string;
  label: string;
  status: GamePoolRoomSummary["status"];
  playerCount: number;
  capacity: number;
  actors: GamePoolLobbyActor[];
  hiddenCount: number;
}

export interface GamePoolLobbyScene {
  rooms: GamePoolLobbyRoom[];
  hiddenRoomCount: number;
  waitingPlayerCount: number;
  waitingRoomCount: number;
  playingRoomCount: number;
}

function stableTone(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function visibleOccupants(room: GamePoolRoomSummary): GamePoolPublicOccupant[] {
  if (room.occupants.length >= room.playerCount) return room.occupants;
  const occupants = [...room.occupants];
  for (let index = occupants.length; index < room.playerCount; index += 1)
    occupants.push({ id: `${room.roomId}:anonymous:${index}` });
  return occupants;
}

export function buildGamePoolLobbyScene(
  rooms: GamePoolRoomSummary[],
  priorityRoomId?: string,
): GamePoolLobbyScene {
  const byCreation = (left: GamePoolRoomSummary, right: GamePoolRoomSummary) => {
    if (left.roomId === priorityRoomId) return -1;
    if (right.roomId === priorityRoomId) return 1;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  };
  const openRooms = rooms.filter(({ status }) => status === "open").sort(byCreation);
  const playingRooms = rooms.filter(({ status }) => status === "started").sort(byCreation);
  const visibleOpenLimit =
    playingRooms.length > 0 ? GAME_POOL_LOBBY_ROOM_LIMIT - 1 : GAME_POOL_LOBBY_ROOM_LIMIT;
  const visibleRooms = [
    ...openRooms.slice(0, visibleOpenLimit),
    ...playingRooms,
    ...openRooms.slice(visibleOpenLimit),
  ].slice(0, GAME_POOL_LOBBY_ROOM_LIMIT);
  return {
    rooms: visibleRooms.map((room) => {
      const occupants = visibleOccupants(room);
      return {
        roomId: room.roomId,
        label: room.label,
        status: room.status,
        playerCount: room.playerCount,
        capacity: room.capacity,
        actors: occupants.slice(0, GAME_POOL_LOBBY_OCCUPANT_LIMIT).map((occupant, seat) => ({
          id: occupant.id,
          label: occupant.label,
          seat,
          tone: stableTone(occupant.id),
        })),
        hiddenCount: Math.max(0, room.playerCount - GAME_POOL_LOBBY_OCCUPANT_LIMIT),
      };
    }),
    hiddenRoomCount: Math.max(0, rooms.length - GAME_POOL_LOBBY_ROOM_LIMIT),
    waitingPlayerCount: rooms
      .filter(({ status }) => status === "open")
      .reduce((total, room) => total + room.playerCount, 0),
    waitingRoomCount: openRooms.length,
    playingRoomCount: rooms.filter(({ status }) => status === "started").length,
  };
}

export function gamePoolLobbyStatus(input: {
  destinationRoomId: string | null;
  joining: boolean;
  rooms: GamePoolLobbyRoom[];
  waitingPlayerCount: number;
  waitingRoomCount: number;
}) {
  if (input.destinationRoomId) {
    const room = input.rooms.find(({ roomId }) => roomId === input.destinationRoomId);
    return room ? `${room.label} found · heading over` : "room found · heading over";
  }
  if (input.joining) return "finding you a room…";
  if (input.waitingPlayerCount === 0) return "the next room is ready when you are";
  return `${input.waitingPlayerCount} waiting across ${input.waitingRoomCount} ${input.waitingRoomCount === 1 ? "room" : "rooms"}`;
}
