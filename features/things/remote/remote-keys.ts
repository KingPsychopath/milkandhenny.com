import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";
import type { RemoteGameKind } from "./types";

export function pairedGameRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("remote", 3, roomId);
  return {
    meta: `${base}:meta`,
    setup: `${base}:setup`,
    snapshot: `${base}:snapshot`,
    commands: `${base}:commands`,
    commandIds: `${base}:commands:ids`,
    decidedItems: `${base}:commands:decided-items`,
    playerPresence: `${base}:presence:player`,
    playerEpoch: `${base}:lease:player`,
    judgePresence: `${base}:presence:judge`,
    judgeEpoch: `${base}:lease:judge`,
    commandRate: `${base}:ratelimit:commands`,
    commandSequence: `${base}:sequence:commands`,
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
