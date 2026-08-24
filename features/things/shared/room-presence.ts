/** Avoid rewriting a room for every socket wake while keeping presence fresh. */
export const MULTIPLAYER_PRESENCE_TOUCH_INTERVAL_MS = 10_000;

export function touchMultiplayerPresence(
  player: { lastSeenAt: number },
  now = Date.now(),
  force = false,
) {
  if (!force && now - player.lastSeenAt < MULTIPLAYER_PRESENCE_TOUCH_INTERVAL_MS) return false;
  player.lastSeenAt = now;
  return true;
}
