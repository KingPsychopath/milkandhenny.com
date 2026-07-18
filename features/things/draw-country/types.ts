import type {
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";

export interface DrawPoint {
  x: number;
  y: number;
}

export type CountryDrawing = DrawPoint[][];

export interface CountryOutline {
  id: string;
  name: string;
  continent: string;
  aspect: number;
  rings: number[][][];
}

export interface CountryScore {
  score: number;
  deviation: number;
  borderDeviation: number;
  outsideDeviation: number;
  insideDeviation: number;
  coverageDeviation: number;
  islandDeviation: number;
  accuracy: "uncanny" | "close" | "recognisable" | "adventurous";
}

export type DrawCountryPhase = "lobby" | "drawing" | "reveal" | "finished";

export interface DrawCountryPlayer {
  id: string;
  name: string;
  score: number;
  roundScore: number | null;
  submitted: boolean;
  connected: boolean;
  place: number | null;
}

export interface DrawCountryRound {
  id: string;
  number: number;
  total: number;
  countryId: string;
  countryName: string;
  startsAt: number;
  endsAt: number;
  revealAt: number | null;
  nextRoundAt: number | null;
}

export interface DrawCountrySnapshot extends MultiplayerRevision, MultiplayerSequence {
  roomId: string;
  phase: DrawCountryPhase;
  serverNow: number;
  hostPlayerId: string;
  canControl: boolean;
  players: DrawCountryPlayer[];
  round: DrawCountryRound | null;
}

export interface DrawCountryRoomCredentials extends MultiplayerRoomLifetime {
  hostToken: string;
  joinToken: string;
}

export interface DrawCountryPlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  snapshot: DrawCountrySnapshot;
}

export type DrawCountryJoinResult =
  | MultiplayerSuccess<DrawCountryPlayerCredentials>
  | MultiplayerFailure<
      | "game_started"
      | "invite_expired"
      | "invalid_name"
      | "name_taken"
      | "room_full"
      | "room_unavailable"
    >;

export type DrawCountrySnapshotResult =
  | MultiplayerSuccess<{ snapshot: DrawCountrySnapshot }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type DrawCountryActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: DrawCountrySnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      error: string;
      snapshot: DrawCountrySnapshot;
    }>
  | (MultiplayerFailure<"room_unavailable"> & {
      accepted: false;
      snapshot: null;
    });
