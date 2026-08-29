import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function hotAndColdRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("hot-and-cold", 2, roomId);
  return { state: `${base}:state`, lock: `${base}:lock` };
}

export const hotAndColdRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("hot-and-cold", 2, roomId);

export const hotAndColdBrowserKeys = {
  playerSession: (roomId: string) =>
    gameBrowserKey("hot-and-cold", 2, "room", roomId, "player-session"),
  invite: (roomId: string) => gameBrowserKey("hot-and-cold", 2, "room", roomId, "invite"),
  daily: (puzzle: number, judgingVersion: string) =>
    gameBrowserKey("hot-and-cold", 2, "daily", judgingVersion, String(puzzle)),
};
