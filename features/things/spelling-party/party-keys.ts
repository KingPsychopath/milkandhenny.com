import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function partyRoomRedisKeys(roomId: string, legacy = false) {
  const base = legacy
    ? `spelling-party:v1:${roomId}`
    : gameRoomNamespace("spelling-party", 2, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    joinReceipt: (joinId: string) => `${base}:join-receipt:${joinId}`,
  };
}

export const partyRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("spelling-party", 2, roomId);

export const partyBrowserKeys = {
  presenterSession: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "presenter-session"),
  presenterRecovery: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "presenter-recovery"),
  invite: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "invite"),
  playerSession: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "player-session"),
  pendingActions: (roomId: string, playerId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "player", playerId, "pending-actions"),
  draft: (roomId: string, roundId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "round", roundId, "draft"),
  draftPrefix: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "round", ""),
} as const;

export const legacyPartyBrowserKeys = {
  presenterToken: (roomId: string) => `spelling-party-presenter:v1:${roomId}`,
  joinToken: (roomId: string) => `spelling-party-join:v1:${roomId}`,
  invite: (roomId: string) => `spelling-party-invite:v1:${roomId}`,
  playerSession: (roomId: string) => `spelling-party-player:v1:${roomId}`,
  pendingActions: (roomId: string, playerId: string) => `spelling-party-actions:v1:${roomId}:${playerId}`,
  draft: (roomId: string, roundId: string) => `spelling-party-draft:v1:${roomId}:${roundId}`,
  draftPrefix: (roomId: string) => `spelling-party-draft:v1:${roomId}:`,
} as const;
