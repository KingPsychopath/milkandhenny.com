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
  invite: (roomId: string) => gameBrowserKey("liars", 1, "room", roomId, "invite"),
  pendingActions: (roomId: string, playerId: string) =>
    gameBrowserKey("liars", 1, "room", roomId, "player", playerId, "pending-actions"),
  /** House rules, kept per device so a group's setup is one tap next time. */
  setupPreset: (mode: string) => gameBrowserKey("liars", 1, "setup", mode),
  /** Device-wide, not per room: whichever phone you mute stays muted for the next game too. */
  muted: () => gameBrowserKey("liars", 1, "sound-muted"),
} as const;
