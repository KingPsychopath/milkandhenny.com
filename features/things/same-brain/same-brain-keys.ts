import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function sameBrainRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("same-brain", 1, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    joinReceipt: (joinId: string) => `${base}:join-receipt:${joinId}`,
  };
}

/**
 * Embeddings are cached outside any room. A word means the same thing in every game, the vector for
 * it costs the same to compute whoever asked, and the bank of words a party actually types is small
 * — so this key is deliberately global and long-lived where room state is neither.
 */
export function sameBrainVectorKey(model: string, word: string) {
  return `things:same-brain:v1:vector:${model}:${word}`;
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
