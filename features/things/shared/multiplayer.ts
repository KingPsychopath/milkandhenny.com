// Room records need enough time for setup, reconnects and a full session, without retaining
// abandoned transient state for the rest of the day.
export const MULTIPLAYER_ROOM_TTL_SECONDS = 90 * 60;
export const MULTIPLAYER_EMPTY_LOBBY_TTL_SECONDS = 5 * 60;
export const MULTIPLAYER_LOBBY_TTL_SECONDS = 30 * 60;
export const MULTIPLAYER_PRESENCE_LEASE_SECONDS = 15 * 60;
export const MULTIPLAYER_ROOM_ID_LENGTH = 7;
export const MULTIPLAYER_ROOM_ID_PATTERN = /^[A-Z2-9]{7}$/;
export const MULTIPLAYER_ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type MultiplayerConnectionState = "connected" | "reconnecting" | "offline";

export function multiplayerLobbyExpiresAt(now = Date.now(), playerCount = 1) {
  const seconds =
    playerCount === 0 ? MULTIPLAYER_EMPTY_LOBBY_TTL_SECONDS : MULTIPLAYER_LOBBY_TTL_SECONDS;
  return now + seconds * 1_000;
}

export function multiplayerPresenceLeaseExpiresAt(now = Date.now()) {
  return now + MULTIPLAYER_PRESENCE_LEASE_SECONDS * 1_000;
}

export interface MultiplayerRoomIdentity {
  roomId: string;
}

export interface MultiplayerRoomLifetime extends MultiplayerRoomIdentity {
  expiresAt: number;
}

export interface MultiplayerRevision {
  revision: number;
}

export interface MultiplayerSequence {
  sequence: number;
}

export interface MultiplayerAction {
  actionId: string;
}

export type MultiplayerActionInput<Action> = Action extends unknown
  ? Omit<Action, "actionId">
  : never;

export interface MultiplayerFailure<Code extends string> {
  ok: false;
  errorCode: Code;
  error: string;
  retryable: boolean;
}

export type MultiplayerSuccess<Value extends object> = { ok: true } & Value;

export function multiplayerFailure<Code extends string>(
  errorCode: Code,
  error: string,
  retryable = false,
): MultiplayerFailure<Code> {
  return { ok: false, errorCode, error, retryable };
}
