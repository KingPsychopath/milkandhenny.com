import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function sameBrainRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("same-brain", 1, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    joinReceipt: (joinId: string) => `${base}:join-receipt:${joinId}`,
  };
}

export const sameBrainRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("same-brain", 1, roomId);

export const sameBrainBrowserKeys = {
  hostSession: (roomId: string) => gameBrowserKey("same-brain", 1, "room", roomId, "host-session"),
  playerSession: (roomId: string) =>
    gameBrowserKey("same-brain", 1, "room", roomId, "player-session"),
  /** localStorage, not session: people close tabs to change wifi and come back. */
  invite: (roomId: string) => gameBrowserKey("same-brain", 1, "room", roomId, "invite"),
  // House rules are remembered by `useGamePreferences("same-brain")`, which owns its own key — the
  // same mechanism as every other game, so "does it remember?" has one answer here.
  muted: () => gameBrowserKey("same-brain", 1, "sound-muted"),
} as const;
