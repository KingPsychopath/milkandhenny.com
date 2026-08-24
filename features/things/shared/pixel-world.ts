export type PixelWorldGame =
  | "hotel"
  | "lost"
  | "liars"
  | "mafia"
  | "imposter"
  | "same-brain"
  | "centre"
  | "twin"
  | "draw-country";

export type PixelWorldRole = "player" | "concierge" | "arranger" | "lost-guest" | "passerby";

export interface PixelWorldPlayer {
  id: string;
  name?: string;
  ready: boolean;
  lead?: boolean;
  left?: boolean;
  entering?: boolean;
  role?: PixelWorldRole;
}

export interface PixelWorldRoom {
  game: PixelWorldGame;
  roomId: string;
  status: "waiting" | "playing" | "next";
  players: PixelWorldPlayer[];
  capacity: number;
  variant?: number;
}

export function pixelWorldHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pixelWorldVariant(roomId: string) {
  return pixelWorldHash(roomId) % 4;
}

export function pixelWorldTone(playerId: string) {
  return pixelWorldHash(playerId) % 8;
}

export function visiblePixelWorldPlayers(players: PixelWorldPlayer[], limit = 8) {
  return players.filter(({ left }) => !left).slice(0, limit);
}

export function pixelWorldRoomSummary(room: PixelWorldRoom) {
  const present = room.players.filter(({ left }) => !left);
  const ready = present.filter((player) => player.ready).length;
  if (room.status === "playing") return `${present.length} playing`;
  if (room.status === "next") return "ready for the next group";
  return `${ready} of ${present.length} ready`;
}
