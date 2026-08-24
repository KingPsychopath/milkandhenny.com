import {
  gameSettingsDocument,
  parseGameSettingsDocument,
  type GameSettingsDocument,
} from "../shared/game-settings";
import { GAME_POOL_GAMES, type GamePoolGame } from "./types";

export const GAME_POOL_ADMISSION_DEFAULTS = {
  autoJoin: true,
  allowRoomChoice: true,
  allowNewRooms: true,
  nameVisibility: "initials",
} as const;

export const GAME_POOL_ALLOCATION_STRATEGY = "fill-first" as const;

export const GAME_POOL_DEFAULTS: Record<
  GamePoolGame,
  { label: string; targetSize: number; capacity: number; gameSettings: GameSettingsDocument }
> = {
  "same-brain": {
    label: "same brain",
    targetSize: 8,
    capacity: 16,
    gameSettings: gameSettingsDocument("same-brain"),
  },
  liars: {
    label: "liars",
    targetSize: 9,
    capacity: 16,
    gameSettings: gameSettingsDocument("liars"),
  },
  centre: {
    label: "centre",
    targetSize: 6,
    capacity: 8,
    gameSettings: gameSettingsDocument("centre"),
  },
  twin: {
    label: "twin",
    targetSize: 6,
    capacity: 12,
    gameSettings: gameSettingsDocument("twin"),
  },
  "draw-country": {
    label: "draw the country",
    targetSize: 8,
    capacity: 16,
    gameSettings: gameSettingsDocument("draw-country"),
  },
};

export function isGamePoolGame(value: unknown): value is GamePoolGame {
  return GAME_POOL_GAMES.includes(value as GamePoolGame);
}

/**
 * Postgres stores only the native settings payload because the entrance row already owns the game.
 * Browser and admin contracts receive the complete versioned document.
 */
export function poolGameSettings(value: unknown, game: GamePoolGame): GameSettingsDocument {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const discriminator = (value as Record<string, unknown>).game;
    if (typeof discriminator === "string" && discriminator !== game) {
      const displayName = game === "same-brain" ? "Same Brain" : game;
      throw new Error(`These are not ${displayName} settings.`);
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "format" in value) {
    const document = parseGameSettingsDocument(value);
    if (document.game !== game) throw new Error("The game settings do not match this pool.");
    return document;
  }
  return gameSettingsDocument(game, value);
}
