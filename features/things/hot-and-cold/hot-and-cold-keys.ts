import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function hotAndColdRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("hot-and-cold", 1, roomId);
  return { state: `${base}:state`, lock: `${base}:lock` };
}

export const hotAndColdRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("hot-and-cold", 1, roomId);

export const hotAndColdBrowserKeys = {
  playerSession: (roomId: string) =>
    gameBrowserKey("hot-and-cold", 1, "room", roomId, "player-session"),
  invite: (roomId: string) => gameBrowserKey("hot-and-cold", 1, "room", roomId, "invite"),
  daily: (puzzle: number) => gameBrowserKey("hot-and-cold", 1, "daily", String(puzzle)),
};
