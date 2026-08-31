import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function familyFeudRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("family-feud", 1, roomId);
  return { state: `${base}:state`, lock: `${base}:lock` };
}

export const familyFeudRealtimeChannel = (roomId: string) =>
  gameRealtimeChannel("family-feud", 1, roomId);

export const familyFeudBrowserKeys = {
  presenterSession: (roomId: string) =>
    gameBrowserKey("family-feud", 1, "room", roomId, "presenter-session"),
  presenterRecovery: (roomId: string) =>
    gameBrowserKey("family-feud", 1, "room", roomId, "presenter-recovery"),
  controllerSession: (roomId: string) =>
    gameBrowserKey("family-feud", 1, "room", roomId, "controller-session"),
  buzzerSession: (roomId: string, teamId: "one" | "two" | "shared" = "shared") =>
    gameBrowserKey("family-feud", 1, "room", roomId, `buzzer-session-${teamId}`),
  muted: () => gameBrowserKey("family-feud", 1, "sound-muted"),
  customDecks: () => gameBrowserKey("family-feud", 1, "custom-decks"),
} as const;
