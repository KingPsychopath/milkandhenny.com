import {
  GAME_POOL_ADMISSION_DEFAULTS,
  GAME_POOL_ALLOCATION_STRATEGY,
  GAME_POOL_DEFAULTS,
  gamePoolPreset,
  isGamePoolGame,
} from "./presets";
import type {
  GamePoolEntrance,
  GamePoolGame,
  GamePoolNameVisibility,
  GamePoolPreset,
} from "./types";

export const GAME_POOL_PRESET_BUNDLE_FORMAT = "milk-and-henny/game-pool-settings";
export const GAME_POOL_PRESET_BUNDLE_VERSION = 1;
export const GAME_POOL_PRESET_BUNDLE_MAX_BYTES = 64 * 1024;

export interface GamePoolPresetBundle {
  format: typeof GAME_POOL_PRESET_BUNDLE_FORMAT;
  schemaVersion: typeof GAME_POOL_PRESET_BUNDLE_VERSION;
  game: GamePoolGame;
  label: string;
  targetSize: number;
  allocation: {
    strategy: typeof GAME_POOL_ALLOCATION_STRATEGY;
  };
  admission: {
    autoJoin: boolean;
    allowRoomChoice: boolean;
    allowNewRooms: boolean;
    nameVisibility: GamePoolNameVisibility;
  };
  preset: GamePoolPreset;
}

type PortableEntrance = Pick<
  GamePoolEntrance,
  | "game"
  | "label"
  | "targetSize"
  | "autoJoin"
  | "allowRoomChoice"
  | "allowNewRooms"
  | "nameVisibility"
  | "preset"
>;

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`“${key}” must be true or false.`);
  return value;
}

function validatePreset(value: unknown, game: GamePoolGame) {
  const record = object(value, "The game preset is missing.");
  if (record.game !== game) throw new Error("The preset does not match the selected game.");
  const normalized = gamePoolPreset(record, game);
  for (const [key, expected] of Object.entries(normalized))
    if (record[key] !== expected) throw new Error(`The preset setting “${key}” is not valid.`);
  return normalized;
}

export function recommendedGamePoolPresetBundle(
  game: GamePoolGame,
  label = GAME_POOL_DEFAULTS[game].label,
): GamePoolPresetBundle {
  const defaults = GAME_POOL_DEFAULTS[game];
  return {
    format: GAME_POOL_PRESET_BUNDLE_FORMAT,
    schemaVersion: GAME_POOL_PRESET_BUNDLE_VERSION,
    game,
    label,
    targetSize: defaults.targetSize,
    allocation: { strategy: GAME_POOL_ALLOCATION_STRATEGY },
    admission: { ...GAME_POOL_ADMISSION_DEFAULTS },
    preset: { ...defaults.preset },
  };
}

export function gamePoolPresetBundle(entrance: PortableEntrance): GamePoolPresetBundle {
  return {
    format: GAME_POOL_PRESET_BUNDLE_FORMAT,
    schemaVersion: GAME_POOL_PRESET_BUNDLE_VERSION,
    game: entrance.game,
    label: entrance.label,
    targetSize: entrance.targetSize,
    allocation: { strategy: GAME_POOL_ALLOCATION_STRATEGY },
    admission: {
      autoJoin: entrance.autoJoin,
      allowRoomChoice: entrance.allowRoomChoice,
      allowNewRooms: entrance.allowNewRooms,
      nameVisibility: entrance.nameVisibility,
    },
    preset: entrance.preset,
  };
}

export function parseGamePoolPresetBundle(input: unknown): GamePoolPresetBundle {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > GAME_POOL_PRESET_BUNDLE_MAX_BYTES)
      throw new Error("The settings file is too large.");
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("Paste a valid JSON settings bundle.");
    }
  }
  const record = object(value, "The settings bundle is not valid.");
  if (record.format !== GAME_POOL_PRESET_BUNDLE_FORMAT)
    throw new Error("This is not a game-pool settings bundle.");
  if (record.schemaVersion !== GAME_POOL_PRESET_BUNDLE_VERSION)
    throw new Error("This settings version is not supported.");
  if (!isGamePoolGame(record.game)) throw new Error("This bundle uses an unsupported game.");
  const game = record.game;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label || label.length > 80) throw new Error("The entrance label must use 1–80 characters.");
  const targetSize = record.targetSize;
  if (
    typeof targetSize !== "number" ||
    !Number.isInteger(targetSize) ||
    targetSize < 2 ||
    targetSize > GAME_POOL_DEFAULTS[game].capacity
  )
    throw new Error(
      `The target room size must be between 2 and ${GAME_POOL_DEFAULTS[game].capacity}.`,
    );
  const admission = object(record.admission, "The admission settings are missing.");
  const allocation = object(record.allocation, "The allocation settings are missing.");
  if (allocation.strategy !== GAME_POOL_ALLOCATION_STRATEGY)
    throw new Error("This room-allocation strategy is not supported.");
  const nameVisibility = admission.nameVisibility;
  if (
    nameVisibility !== "first-names" &&
    nameVisibility !== "initials" &&
    nameVisibility !== "counts"
  )
    throw new Error("Choose first names, initials, or counts for the room list.");
  return {
    format: GAME_POOL_PRESET_BUNDLE_FORMAT,
    schemaVersion: GAME_POOL_PRESET_BUNDLE_VERSION,
    game,
    label,
    targetSize,
    allocation: { strategy: GAME_POOL_ALLOCATION_STRATEGY },
    admission: {
      autoJoin: requiredBoolean(admission, "autoJoin"),
      allowRoomChoice: requiredBoolean(admission, "allowRoomChoice"),
      allowNewRooms: requiredBoolean(admission, "allowNewRooms"),
      nameVisibility,
    },
    preset: validatePreset(record.preset, game),
  };
}

export function serializeGamePoolPresetBundle(bundle: GamePoolPresetBundle) {
  return `${JSON.stringify(parseGamePoolPresetBundle(bundle), null, 2)}\n`;
}

export function gamePoolPresetBundleFilename(bundle: GamePoolPresetBundle) {
  const label = bundle.label
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLocaleLowerCase()
    .slice(0, 60);
  return `${label || bundle.game}-game-pool.json`;
}
