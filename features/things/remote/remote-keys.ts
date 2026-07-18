import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";
import type { RemoteGameKind } from "./types";

export function pairedGameRoomRedisKeys(roomId: string, legacy = false) {
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

export const pairedGameRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("remote", 3, roomId);

export const remoteBrowserKeys = {
  hostSession: (game: RemoteGameKind) => gameBrowserKey("remote", 3, "host", game, "session"),
  judgeSession: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "judge-session"),
  playerSession: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "player-session"),
  pendingCommands: (roomId: string) => gameBrowserKey("remote", 3, "room", roomId, "pending-commands"),
} as const;

export const legacyRemoteBrowserKeys = {
  hostSession: (game: RemoteGameKind) => `thing-remote-player:v2:${game}`,
  judgeToken: (roomId: string) => `thing-judge-token:v2:${roomId}`,
  playerInviteToken: (roomId: string) => `thing-player-invite-token:v2:${roomId}`,
  judgeGame: (roomId: string) => `thing-judge-game:v2:${roomId}`,
  playerToken: (roomId: string) => `thing-player-token:v2:${roomId}`,
  playerSession: (roomId: string) => `thing-player-session:v2:${roomId}`,
  pendingCommands: (roomId: string) => `thing-judge-command-queue:v2:${roomId}`,
} as const;
