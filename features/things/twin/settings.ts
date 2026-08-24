import { TWIN_DEFAULT_HAND, TWIN_MAX_HAND, TWIN_MIN_HAND } from "./twin-deck";

export interface TwinGameSettings {
  game: "twin";
  handSize: number;
}

export const TWIN_GAME_SETTINGS: TwinGameSettings = {
  game: "twin",
  handSize: TWIN_DEFAULT_HAND,
};

export function parseTwinGameSettings(value: unknown): TwinGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Twin settings are missing.");
  const input = value as Record<string, unknown>;
  if (input.game !== "twin") throw new Error("These are not Twin settings.");
  if (
    typeof input.handSize !== "number" ||
    !Number.isInteger(input.handSize) ||
    input.handSize < TWIN_MIN_HAND ||
    input.handSize > TWIN_MAX_HAND
  )
    throw new Error(`Twin hand size must be between ${TWIN_MIN_HAND} and ${TWIN_MAX_HAND}.`);
  return { game: "twin", handSize: input.handSize };
}
