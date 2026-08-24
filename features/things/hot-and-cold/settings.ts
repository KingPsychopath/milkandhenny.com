import {
  HOT_AND_COLD_DEFAULT_GUESSES,
  HOT_AND_COLD_DEFAULT_ROUNDS,
  HOT_AND_COLD_DEFAULT_TURN_SECONDS,
  HOT_AND_COLD_GUESS_LIMITS,
  HOT_AND_COLD_ROUND_LIMITS,
} from "./hot-and-cold-rules";

export interface HotAndColdGameSettings {
  game: "hot-and-cold";
  rounds: number;
  guessesPerPlayer: number;
  turnSeconds: number;
}

export const HOT_AND_COLD_GAME_SETTINGS: HotAndColdGameSettings = {
  game: "hot-and-cold",
  rounds: HOT_AND_COLD_DEFAULT_ROUNDS,
  guessesPerPlayer: HOT_AND_COLD_DEFAULT_GUESSES,
  turnSeconds: HOT_AND_COLD_DEFAULT_TURN_SECONDS,
};

export function parseHotAndColdGameSettings(value: unknown): HotAndColdGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Hot and Cold settings are missing.");
  const input = value as Record<string, unknown>;
  const rounds = Number(input.rounds);
  const guessesPerPlayer = Number(input.guessesPerPlayer);
  const turnSeconds = Number(input.turnSeconds);
  if (
    !Number.isInteger(rounds) ||
    rounds < HOT_AND_COLD_ROUND_LIMITS.min ||
    rounds > HOT_AND_COLD_ROUND_LIMITS.max
  )
    throw new Error("Rounds must be between 1 and 7.");
  if (
    !Number.isInteger(guessesPerPlayer) ||
    guessesPerPlayer < HOT_AND_COLD_GUESS_LIMITS.min ||
    guessesPerPlayer > HOT_AND_COLD_GUESS_LIMITS.max
  )
    throw new Error("Guesses must be between 2 and 10.");
  if (![0, 10, 15, 20, 30].includes(turnSeconds)) throw new Error("Choose a supported turn time.");
  return { game: "hot-and-cold", rounds, guessesPerPlayer, turnSeconds };
}
