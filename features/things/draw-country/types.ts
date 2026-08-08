import type {
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";
import type { MultiplayerReadiness } from "../shared/multiplayer-readiness";

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
  mismatchDeviation: number;
  borderDeviation: number;
  outsideDeviation: number;
  insideDeviation: number;
  coverageDeviation: number;
  silhouetteDeviation: number;
  strokeDeviation: number;
  islandDeviation: number;
  accuracy: "uncanny" | "close" | "recognisable" | "adventurous";
}

export type DrawCountryPhase = "lobby" | "drawing" | "reveal" | "finished";

export interface DrawCountryPlayer {
  id: string;
  name: string;
  /** This game only. Reset by a rematch. */
  score: number;
  /** Every game played on this room code, including the one in progress. */
  sessionScore: number;
  roundScore: number | null;
  submitted: boolean;
  connected: boolean;
  ready: boolean;
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
  /** Hash of this viewer's redacted view, filled in by the read. */
  digest?: string;
  roomId: string;
  phase: DrawCountryPhase;
  serverNow: number;
  hostPlayerId: string;
  canControl: boolean;
  /** 1 for the first game on this room code, incremented by every rematch. */
  gameNumber: number;
  /** Current room expiry, so a client can keep its stored credentials in step after a rematch. */
  expiresAt: number;
  players: DrawCountryPlayer[];
  player: MultiplayerReadiness;
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
  // `unchanged` sits on both success arms so it discriminates them; without it here, narrowing
  // leaves `snapshot` nullable at every call site.
  | MultiplayerSuccess<{ unchanged?: false; snapshot: DrawCountrySnapshot }>
  /** The viewer's digest matched, so the body was left off. */
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type DrawCountryActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: DrawCountrySnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      errorCode?: "players_not_ready" | "action_unavailable" | "countries_exhausted";
      error: string;
      snapshot: DrawCountrySnapshot;
    }>
  | (MultiplayerFailure<"room_unavailable"> & {
      accepted: false;
      snapshot: null;
    });
