import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function liarsRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("liars", 1, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    joinReceipt: (joinId: string) => `${base}:join-receipt:${joinId}`,
  };
}

export const liarsRealtimeChannel = (roomId: string) => gameRealtimeChannel("liars", 1, roomId);

export const liarsBrowserKeys = {
  hostSession: (roomId: string) => gameBrowserKey("liars", 1, "room", roomId, "host-session"),
  playerSession: (roomId: string) => gameBrowserKey("liars", 1, "room", roomId, "player-session"),
  /** localStorage, not session: people close tabs to change wifi and come back. */
  invite: (roomId: string) => gameBrowserKey("liars", 1, "room", roomId, "invite"),
  pendingActions: (roomId: string, playerId: string) =>
    gameBrowserKey("liars", 1, "room", roomId, "player", playerId, "pending-actions"),
  notes: (roomId: string, playerId: string, gameNumber: number) =>
    gameBrowserKey("liars", 1, "room", roomId, "player", playerId, "notes", String(gameNumber)),
  /** Device-wide, not per room: whichever phone you mute stays muted for the next game too. */
  muted: () => gameBrowserKey("liars", 1, "sound-muted"),
} as const;
