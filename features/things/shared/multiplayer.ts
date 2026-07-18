export const MULTIPLAYER_ROOM_TTL_SECONDS = 4 * 60 * 60;
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
