import { gameBrowserKey, gameRealtimeChannel, gameRoomNamespace } from "../shared/multiplayer-keys";

export function twinRoomRedisKeys(roomId: string) {
  const base = gameRoomNamespace("twin", 1, roomId);
  return {
    state: `${base}:state`,
    lock: `${base}:lock`,
    /**
     * The heat log lives apart from room state and is never read during play.
     *
     * Twelve players over fifty heats is six hundred result records. Carried in the room value, that
     * is tens of kilobytes re-read by every player on every poll for the whole game — the exact shape
     * of docs/postmortem-guestlist-kv-read-spike.md. It is appended at each settle and read once, at
     * the end, for the constellation.
     */
    log: `${base}:log`,
  };
}

export const twinRealtimeChannel = (roomId: string) => gameRealtimeChannel("twin", 1, roomId);

export const twinBrowserKeys = {
  invite: (roomId: string) => gameBrowserKey("twin", 1, "room", roomId, "invite"),
  playerSession: (roomId: string) => gameBrowserKey("twin", 1, "room", roomId, "player-session"),
} as const;
