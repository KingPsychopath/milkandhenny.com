import { SAME_BRAIN_ROUND_LIMITS } from "./same-brain-rules";
import type { SameBrainScoring } from "./types";

export interface SameBrainGameSettings {
  game: "same-brain";
  rounds: number;
  scoring: SameBrainScoring;
  sayItAloud: boolean;
  eliminateOddOne: boolean;
}

export const SAME_BRAIN_GAME_SETTINGS: SameBrainGameSettings = {
  game: "same-brain",
  rounds: 8,
  scoring: "embedding",
  sayItAloud: true,
  eliminateOddOne: false,
};

export function parseSameBrainGameSettings(value: unknown): SameBrainGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Same Brain settings are missing.");
  const input = value as Record<string, unknown>;
  if (input.game !== "same-brain") throw new Error("These are not Same Brain settings.");
  if (
    typeof input.rounds !== "number" ||
    !Number.isInteger(input.rounds) ||
    input.rounds < SAME_BRAIN_ROUND_LIMITS.min ||
    input.rounds > SAME_BRAIN_ROUND_LIMITS.max
  )
    throw new Error(
      `Same Brain rounds must be between ${SAME_BRAIN_ROUND_LIMITS.min} and ${SAME_BRAIN_ROUND_LIMITS.max}.`,
    );
  if (input.scoring !== "embedding" && input.scoring !== "exact")
    throw new Error("Choose meaning or exact-word scoring for Same Brain.");
  if (typeof input.sayItAloud !== "boolean" || typeof input.eliminateOddOne !== "boolean")
    throw new Error("The Same Brain house rules must be true or false.");
  return {
    game: "same-brain",
    rounds: input.rounds,
    scoring: input.scoring,
    sayItAloud: input.sayItAloud,
    eliminateOddOne: input.eliminateOddOne,
  };
}
