// Quick-play rooms need enough time for setup, reconnects and a full session,
// without retaining abandoned transient state for the rest of the day.
export const MULTIPLAYER_ROOM_TTL_SECONDS = 90 * 60;
export const MULTIPLAYER_ROOM_ID_LENGTH = 7;
export const MULTIPLAYER_ROOM_ID_PATTERN = /^[A-Z2-9]{7}$/;
export const MULTIPLAYER_ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type MultiplayerConnectionState = "connected" | "reconnecting" | "offline";

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
