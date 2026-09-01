import {
  GAME_SETTINGS_GAMES,
  type GameSettingsDocument,
  type GameSettingsGame,
} from "../shared/game-settings";

export const GAME_POOL_GAMES = GAME_SETTINGS_GAMES;
export type GamePoolGame = GameSettingsGame;
export type GamePoolNameVisibility = "first-names" | "initials" | "counts";
export type GamePoolRunStatus = "open" | "paused" | "closed";

export interface GamePoolEntrance {
  id: string;
  token: string;
  label: string;
  game: GamePoolGame;
  isDefault: boolean;
  gameSettings: GameSettingsDocument;
  targetSize: number;
  autoJoin: boolean;
  allowRoomChoice: boolean;
  allowNewRooms: boolean;
  nameVisibility: GamePoolNameVisibility;
  scheduledOpenAt: string | null;
  scheduledCloseAt: string | null;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
  run: GamePoolRun | null;
  /** Present on protected operator and admin views only. */
  rooms?: GamePoolRoomSummary[];
  /** Returned only once when an admin opens a run. */
  operatorToken?: string;
}

/** The only pool data exposed by a public game launcher. */
export interface GamePoolDefaultLaunch {
  label: string;
  game: GamePoolGame;
  path: string;
}

export interface GamePoolRun {
  id: string;
  entranceId: string;
  status: GamePoolRunStatus;
  gameSettings: GameSettingsDocument;
  targetSize: number;
  autoJoin: boolean;
  allowRoomChoice: boolean;
  allowNewRooms: boolean;
  nameVisibility: GamePoolNameVisibility;
  openedAt: string;
  closesAt: string | null;
  closedAt: string | null;
}

export interface GamePoolPublicOccupant {
  /** Opaque within one pool run. Never a player, client, or assignment identifier. */
  id: string;
  /** Omitted when the pool exposes counts only. */
  label?: string;
}

export interface GamePoolRoomSummary {
  roomId: string;
  label: string;
  status: "open" | "started" | "closed";
  playerCount: number;
  capacity: number;
  occupants: GamePoolPublicOccupant[];
  createdAt: string;
}

export interface GamePoolPublicView {
  found: boolean;
  entrance?: Pick<GamePoolEntrance, "label" | "game">;
  run?: GamePoolRun | null;
  rooms?: GamePoolRoomSummary[];
  message?: string;
  scoring?: {
    completionPoints: number;
    winnerTotalPoints: number;
    eligible: boolean;
  };
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
    }
  | {
      game: "hot-and-cold";
      roomId: string;
      expiresAt: number;
      playerId: string;
      playerToken: string;
      snapshot: HotAndColdSnapshot;
    };
import type { CentreSnapshot } from "../centre/types";
import type { DrawCountrySnapshot } from "../draw-country/types";
import type { HotAndColdSnapshot } from "../hot-and-cold/types";
import type { LiarsSnapshot } from "../liars/types";
import type { SameBrainSnapshot } from "../same-brain/types";
import type { TwinSnapshot } from "../twin/types";
