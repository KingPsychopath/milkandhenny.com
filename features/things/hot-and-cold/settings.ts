import {
  HOT_AND_COLD_DEFAULT_GUESSES,
  HOT_AND_COLD_DEFAULT_ROUNDS,
  HOT_AND_COLD_DEFAULT_TURN_SECONDS,
  HOT_AND_COLD_GUESS_LIMITS,
  HOT_AND_COLD_ROUND_LIMITS,
  HOT_AND_COLD_TURN_SECOND_OPTIONS,
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
    throw new Error(
      `Rounds must be between ${HOT_AND_COLD_ROUND_LIMITS.min} and ${HOT_AND_COLD_ROUND_LIMITS.max}.`,
    );
  if (
    !Number.isInteger(guessesPerPlayer) ||
    guessesPerPlayer < HOT_AND_COLD_GUESS_LIMITS.min ||
    guessesPerPlayer > HOT_AND_COLD_GUESS_LIMITS.max
  )
    throw new Error(
      `Guesses must be between ${HOT_AND_COLD_GUESS_LIMITS.min} and ${HOT_AND_COLD_GUESS_LIMITS.max}.`,
    );
  if (!(HOT_AND_COLD_TURN_SECOND_OPTIONS as readonly number[]).includes(turnSeconds))
    throw new Error("Choose a supported turn time.");
  return { game: "hot-and-cold", rounds, guessesPerPlayer, turnSeconds };
}
