import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";
import type { MultiplayerReadiness } from "../shared/multiplayer-readiness";

export type CentreDifficulty = 1 | 2 | 3 | 4 | 5;

export interface CentrePoint {
  /** Canonical maze coordinates. The centre is 0,0 and the outer radius is 1. */
  x: number;
  y: number;
  /** Milliseconds after GO. */
  t: number;
}

/** Each segment starts at the entrance. A new segment means the player used restart. */
export interface CentreRoute {
  segments: CentrePoint[][];
  wallHits: number;
}

export interface CentreMaze {
  seed: number;
  difficulty: CentreDifficulty;
  rings: number;
  sectors: number;
  centreRadius: number;
  links: Record<string, string[]>;
  entranceSectors: number[];
  solutionLengths: number[];
  hash: string;
}

export type CentrePhase =
  | "lobby"
  | "arming"
  | "countdown"
  | "racing"
  | "finishing"
  | "finished"
  | "closed";

export interface CentrePlayerSummary {
  id: string;
  name: string;
  colour: number;
  entranceIndex: number | null;
  connected: boolean;
  ready: boolean;
  armed: boolean;
  finishedAt: number | null;
  elapsedMs: number | null;
  place: number | null;
  wallHits: number;
  resets: number;
  retired: boolean;
  withdrawn: boolean;
}

export interface CentreCourseSnapshot {
  seed: number;
  difficulty: CentreDifficulty;
  playerCount: number;
  hash: string;
  startsAt: number | null;
  firstFinishAt: number | null;
  endsAt: number | null;
}

export interface CentreSnapshot
  extends MultiplayerRevision, MultiplayerSequence, MultiplayerReadiness {
  digest?: string;
  roomId: string;
  managed?: boolean;
  phase: CentrePhase;
  serverNow: number;
  expiresAt: number;
  gameNumber: number;
  hostPlayerId: string;
  canControl: boolean;
  delayedRivals: boolean;
  difficulty: CentreDifficulty;
  players: CentrePlayerSummary[];
  playerId: string;
  course: CentreCourseSnapshot | null;
}

export interface CentreRoomCredentials extends MultiplayerRoomLifetime {
  joinToken: string;
  playerId: string;
  playerToken: string;
  snapshot: CentreSnapshot;
}

export interface CentrePlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  snapshot: CentreSnapshot;
}

export type CentreJoinResult =
  | MultiplayerSuccess<CentrePlayerCredentials>
  | MultiplayerFailure<
      | "game_started"
      | "invite_expired"
      | "invalid_name"
      | "name_taken"
      | "room_full"
      | "room_unavailable"
    >;

export type CentreSnapshotResult =
  | MultiplayerSuccess<{ unchanged?: false; snapshot: CentreSnapshot }>
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type CentreAction = Partial<MultiplayerAction> &
  (
    | { type: "readiness.set"; ready: boolean }
    | { type: "game.configure"; difficulty?: CentreDifficulty; delayedRivals?: boolean }
    | { type: "game.start"; removePlayerIds?: string[] }
    | { type: "arming.set"; armed: boolean }
    | { type: "race.finish"; courseHash: string; route: CentreRoute; claimedElapsedMs: number }
    | { type: "race.progress"; courseHash: string; route: CentreRoute }
    | { type: "race.retire"; courseHash: string; route: CentreRoute }
    | { type: "game.replay" }
    | { type: "game.lobby" }
    | { type: "player.leave" }
    | { type: "player.rename"; name: string }
    | { type: "host.pass"; playerId: string }
  );

export type CentreActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: CentreSnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      errorCode?: "action_unavailable" | "players_not_ready" | "invalid_route";
      error: string;
      snapshot: CentreSnapshot;
    }>
  | (MultiplayerFailure<"room_unavailable"> & { accepted: false; snapshot: null });

export interface CentreReplayPlayer {
  playerId: string;
  name: string;
  colour: number;
  entranceIndex: number;
  elapsedMs: number;
  place: number;
  finished: boolean;
  route: CentreRoute;
}

export type CentreReplayResult =
  | MultiplayerSuccess<{
      course: CentreCourseSnapshot;
      players: CentreReplayPlayer[];
    }>
  | MultiplayerFailure<"not_finished" | "room_unavailable">;
