export const GAME_POOL_GAMES = ["same-brain", "liars", "centre", "twin", "draw-country"] as const;

export type GamePoolGame = (typeof GAME_POOL_GAMES)[number];
export type GamePoolNameVisibility = "first-names" | "initials" | "counts";
export type GamePoolRunStatus = "open" | "paused" | "closed";

export interface SameBrainPoolPreset {
  game: "same-brain";
  rounds: number;
  scoring: "embedding" | "exact";
  sayItAloud: boolean;
  eliminateOddOne: boolean;
}

export interface LiarsPoolPreset {
  game: "liars";
  mode: "mafia" | "imposter";
  roomMode: "same-room" | "remote";
  firstGame: boolean;
  blindImposters: boolean;
  wordBoard: boolean;
}

export interface CentrePoolPreset {
  game: "centre";
  difficulty: 1 | 2 | 3 | 4 | 5;
  delayedRivals: boolean;
}

export interface TwinPoolPreset {
  game: "twin";
  handSize: number;
}

export interface DrawCountryPoolPreset {
  game: "draw-country";
  drawSeconds: number;
  roundTotal: number;
}

export type GamePoolPreset =
  | SameBrainPoolPreset
  | LiarsPoolPreset
  | CentrePoolPreset
  | TwinPoolPreset
  | DrawCountryPoolPreset;

export interface GamePoolEntrance {
  id: string;
  token: string;
  label: string;
  game: GamePoolGame;
  preset: GamePoolPreset;
  targetSize: number;
  autoJoin: boolean;
  allowRoomChoice: boolean;
  allowNewRooms: boolean;
  nameVisibility: GamePoolNameVisibility;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
  run: GamePoolRun | null;
  /** Present on protected operator and admin views only. */
  rooms?: GamePoolRoomSummary[];
  /** Returned only once when an admin opens a run. */
  operatorToken?: string;
}

export interface GamePoolRun {
  id: string;
  entranceId: string;
  status: GamePoolRunStatus;
  preset: GamePoolPreset;
  targetSize: number;
  autoJoin: boolean;
  allowRoomChoice: boolean;
  allowNewRooms: boolean;
  nameVisibility: GamePoolNameVisibility;
  openedAt: string;
  closesAt: string | null;
  closedAt: string | null;
}

export interface GamePoolRoomSummary {
  roomId: string;
  label: string;
  status: "open" | "started" | "closed";
  playerCount: number;
  capacity: number;
  players: string[];
  createdAt: string;
}

export interface GamePoolPublicView {
  found: boolean;
  entrance?: Pick<GamePoolEntrance, "label" | "game">;
  run?: GamePoolRun | null;
  rooms?: GamePoolRoomSummary[];
  message?: string;
}

export interface GamePoolOperatorView {
  found: boolean;
  label?: string;
  game?: GamePoolGame;
  runId?: string;
  status?: GamePoolRunStatus;
  openedAt?: string;
  closesAt?: string | null;
  rooms?: GamePoolRoomSummary[];
  message?: string;
}

export type GamePoolAssignment =
  | {
      game: "same-brain";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot?: SameBrainSnapshot;
    }
  | {
      game: "liars";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot: LiarsSnapshot;
    }
  | {
      game: "centre";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot: CentreSnapshot;
    }
  | {
      game: "twin";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot: TwinSnapshot;
    }
  | {
      game: "draw-country";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot: DrawCountrySnapshot;
    };
import type { CentreSnapshot } from "../centre/types";
import type { DrawCountrySnapshot } from "../draw-country/types";
import type { LiarsSnapshot } from "../liars/types";
import type { SameBrainSnapshot } from "../same-brain/types";
import type { TwinSnapshot } from "../twin/types";
