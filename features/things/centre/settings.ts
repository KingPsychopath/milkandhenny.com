import type { CentreDifficulty } from "./types";

export interface CentreGameSettings {
  game: "centre";
  difficulty: CentreDifficulty;
  delayedRivals: boolean;
}

export const CENTRE_GAME_SETTINGS: CentreGameSettings = {
  game: "centre",
  difficulty: 3,
  delayedRivals: false,
};

export function parseCentreGameSettings(value: unknown): CentreGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Centre settings are missing.");
  const input = value as Record<string, unknown>;
  if (input.game !== "centre") throw new Error("These are not Centre settings.");
  if (
    typeof input.difficulty !== "number" ||
    !Number.isInteger(input.difficulty) ||
    input.difficulty < 1 ||
    input.difficulty > 5
  )
    throw new Error("Centre difficulty must be between 1 and 5.");
  if (typeof input.delayedRivals !== "boolean")
    throw new Error("The delayed-rivals setting must be true or false.");
  return {
    game: "centre",
    difficulty: input.difficulty as CentreDifficulty,
    delayedRivals: input.delayedRivals,
  };
}
