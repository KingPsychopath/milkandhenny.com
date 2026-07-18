import type { RemoteGameKind } from "../remote/types";

const PREFIX = "things";

export function gameNamespace(game: string, version: number) {
  return `${PREFIX}:${game}:v${version}`;
}

export function gameRoomNamespace(game: string, version: number, roomId: string) {
  return `${gameNamespace(game, version)}:room:${roomId}`;
}

export function gameRealtimeChannel(game: string, version: number, roomId: string) {
  return `${gameRoomNamespace(game, version, roomId)}:events`;
}

export function gameBrowserKey(game: string, version: number, ...segments: string[]) {
  return [gameNamespace(game, version), ...segments].join(":");
}

export function remoteRoomRedisKeys(roomId: string, legacy = false) {
  const base = legacy ? `thing-room:v2:${roomId}` : gameRoomNamespace("remote", 3, roomId);
  return {
    meta: `${base}:meta`,
    setup: `${base}:setup`,
    snapshot: `${base}:snapshot`,
    commands: `${base}:commands`,
    commandIds: `${base}:commands:ids`,
    decidedItems: `${base}:commands:decided-items`,
    playerPresence: `${base}:${legacy ? "player" : "presence:player"}`,
    playerEpoch: `${base}:${legacy ? "player-epoch" : "lease:player"}`,
    judgePresence: `${base}:${legacy ? "judge" : "presence:judge"}`,
    judgeEpoch: `${base}:${legacy ? "judge-epoch" : "lease:judge"}`,
    commandRate: `${base}:${legacy ? "command-rate" : "ratelimit:commands"}`,
    commandSequence: `${base}:${legacy ? "command-sequence" : "sequence:commands"}`,
  };
}

export function partyRoomRedisKeys(roomId: string, legacy = false) {
  const base = legacy ? `spelling-party:v1:${roomId}` : gameRoomNamespace("spelling-party", 2, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    joinReceipt: (joinId: string) => `${base}:join-receipt:${joinId}`,
  };
}

export const gameRealtimeChannels = {
  remoteRoom: (roomId: string) => gameRealtimeChannel("remote", 3, roomId),
  spellingPartyRoom: (roomId: string) => gameRealtimeChannel("spelling-party", 2, roomId),
} as const;

export const gameBrowserKeys = {
  remoteHostSession: (game: RemoteGameKind) => gameBrowserKey("remote", 3, "host", game, "session"),
  remoteJudgeSession: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "judge-session"),
  remotePlayerSession: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "player-session"),
  remotePendingCommands: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "pending-commands"),
  partyPresenterSession: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "presenter-session"),
  partyPresenterRecovery: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "presenter-recovery"),
  partyInvite: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "invite"),
  partyPlayerSession: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "player-session"),
  partyPendingActions: (roomId: string, playerId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "player", playerId, "pending-actions"),
  partyDraft: (roomId: string, roundId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "round", roundId, "draft"),
  partyDraftPrefix: (roomId: string) => gameBrowserKey("spelling-party", 2, "room", roomId, "round", ""),
} as const;

export const legacyGameBrowserKeys = {
  remoteHostSession: (game: RemoteGameKind) => `thing-remote-player:v2:${game}`,
  remoteJudgeToken: (roomId: string) => `thing-judge-token:v2:${roomId}`,
  remotePlayerInviteToken: (roomId: string) => `thing-player-invite-token:v2:${roomId}`,
  remoteJudgeGame: (roomId: string) => `thing-judge-game:v2:${roomId}`,
  remotePlayerToken: (roomId: string) => `thing-player-token:v2:${roomId}`,
  remotePlayerSession: (roomId: string) => `thing-player-session:v2:${roomId}`,
  remotePendingCommands: (roomId: string) => `thing-judge-command-queue:v2:${roomId}`,
  partyPresenterToken: (roomId: string) => `spelling-party-presenter:v1:${roomId}`,
  partyJoinToken: (roomId: string) => `spelling-party-join:v1:${roomId}`,
  partyInvite: (roomId: string) => `spelling-party-invite:v1:${roomId}`,
  partyPlayerSession: (roomId: string) => `spelling-party-player:v1:${roomId}`,
  partyPendingActions: (roomId: string, playerId: string) => `spelling-party-actions:v1:${roomId}:${playerId}`,
  partyDraft: (roomId: string, roundId: string) => `spelling-party-draft:v1:${roomId}:${roundId}`,
  partyDraftPrefix: (roomId: string) => `spelling-party-draft:v1:${roomId}:`,
} as const;
