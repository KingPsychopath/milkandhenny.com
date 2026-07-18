import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function drawCountryRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("draw-country", 1, roomId);
  return { state: `${base}:state`, lock: `${base}:lock` };
}

export const drawCountryRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("draw-country", 1, roomId);

export const drawCountryBrowserKeys = {
  invite: (roomId: string) => gameBrowserKey("draw-country", 1, "room", roomId, "invite"),
  playerSession: (roomId: string) =>
    gameBrowserKey("draw-country", 1, "room", roomId, "player-session"),
} as const;
