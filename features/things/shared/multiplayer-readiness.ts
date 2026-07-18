export const MULTIPLAYER_START_NUDGE_COOLDOWN_MS = 10_000;

export interface MultiplayerReadiness {
  ready: boolean;
  startRequestId: string | null;
}

export interface MultiplayerReadinessRecord {
  id: string;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;
}

export function multiplayerPlayerReady(player: MultiplayerReadinessRecord) {
  return player.ready !== false;
}

export function multiplayerUnreadyPlayers<Player extends MultiplayerReadinessRecord>(
  players: Player[],
) {
  return players.filter((player) => !multiplayerPlayerReady(player));
}

export function setMultiplayerPlayerReady(player: MultiplayerReadinessRecord, ready: boolean) {
  player.ready = ready;
  player.startRequestId = null;
  player.startRequestedAt = null;
}

export function requestMultiplayerReadiness(
  players: MultiplayerReadinessRecord[],
  requestId: string,
  now = Date.now(),
) {
  let changed = false;
  for (const player of multiplayerUnreadyPlayers(players)) {
    if (
      player.startRequestedAt &&
      now - player.startRequestedAt < MULTIPLAYER_START_NUDGE_COOLDOWN_MS
    )
      continue;
    player.startRequestId = requestId;
    player.startRequestedAt = now;
    changed = true;
  }
  return changed;
}
