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
