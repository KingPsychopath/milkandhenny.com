import {
  CENTRE_GAME_SETTINGS,
  parseCentreGameSettings,
  type CentreGameSettings,
} from "../centre/settings";
import {
  DRAW_COUNTRY_GAME_SETTINGS,
  parseDrawCountryGameSettings,
  type DrawCountryGameSettings,
} from "../draw-country/settings";
import {
  LIARS_GAME_SETTINGS,
  parseLiarsGameSettings,
  type LiarsGameSettings,
} from "../liars/settings";
import {
  SAME_BRAIN_GAME_SETTINGS,
  parseSameBrainGameSettings,
  type SameBrainGameSettings,
} from "../same-brain/settings";
import { TWIN_GAME_SETTINGS, parseTwinGameSettings, type TwinGameSettings } from "../twin/settings";

export const GAME_SETTINGS_GAMES = [
  "same-brain",
  "liars",
  "centre",
  "twin",
  "draw-country",
] as const;
export type GameSettingsGame = (typeof GAME_SETTINGS_GAMES)[number];
export type GameSettings =
  | SameBrainGameSettings
  | LiarsGameSettings
  | CentreGameSettings
  | TwinGameSettings
  | DrawCountryGameSettings;

export const GAME_SETTINGS_FORMAT = "milk-and-henny/game-settings";
export const GAME_SETTINGS_SCHEMA_VERSION = 1;

export interface GameSettingsDocument {
  format: typeof GAME_SETTINGS_FORMAT;
  schemaVersion: typeof GAME_SETTINGS_SCHEMA_VERSION;
  game: GameSettingsGame;
  settings: GameSettings;
}

export function isGameSettingsGame(value: unknown): value is GameSettingsGame {
  return GAME_SETTINGS_GAMES.includes(value as GameSettingsGame);
}

export function defaultGameSettings(game: GameSettingsGame): GameSettings {
  if (game === "same-brain") return { ...SAME_BRAIN_GAME_SETTINGS };
  if (game === "liars") return { ...LIARS_GAME_SETTINGS };
  if (game === "centre") return { ...CENTRE_GAME_SETTINGS };
  if (game === "twin") return { ...TWIN_GAME_SETTINGS };
  return { ...DRAW_COUNTRY_GAME_SETTINGS };
}

export function parseGameSettings(value: unknown, game: GameSettingsGame): GameSettings {
  if (game === "same-brain") return parseSameBrainGameSettings(value);
  if (game === "liars") return parseLiarsGameSettings(value);
  if (game === "centre") return parseCentreGameSettings(value);
  if (game === "twin") return parseTwinGameSettings(value);
  return parseDrawCountryGameSettings(value);
}

export function gameSettingsDocument(
  game: GameSettingsGame,
  settings: unknown = defaultGameSettings(game),
): GameSettingsDocument {
  return {
    format: GAME_SETTINGS_FORMAT,
    schemaVersion: GAME_SETTINGS_SCHEMA_VERSION,
    game,
    settings: parseGameSettings(settings, game),
  };
}

export function parseGameSettingsDocument(input: unknown): GameSettingsDocument {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("Paste valid game-settings JSON.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The game-settings document is not valid.");
  const document = value as Record<string, unknown>;
  if (document.format !== GAME_SETTINGS_FORMAT)
    throw new Error("This is not a game-settings document.");
  if (document.schemaVersion !== GAME_SETTINGS_SCHEMA_VERSION)
    throw new Error("This game-settings version is not supported.");
  if (!isGameSettingsGame(document.game)) throw new Error("This game is not supported.");
  return gameSettingsDocument(document.game, document.settings);
}

/** Accept a native document or the native document embedded in a pool settings bundle. */
export function parseEmbeddedGameSettingsDocument(input: unknown): GameSettingsDocument {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("Paste valid game-settings JSON.");
    }
  }
  try {
    return parseGameSettingsDocument(value);
  } catch (error) {
    if (value && typeof value === "object" && !Array.isArray(value) && "gameSettings" in value)
      return parseGameSettingsDocument((value as { gameSettings?: unknown }).gameSettings);
    throw error;
  }
}

export function serializeGameSettingsDocument(document: GameSettingsDocument) {
  return `${JSON.stringify(parseGameSettingsDocument(document), null, 2)}\n`;
}
