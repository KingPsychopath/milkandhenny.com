import { GAME_POOL_GAMES, type GamePoolGame, type GamePoolPreset } from "./types";

export const GAME_POOL_DEFAULTS: Record<
  GamePoolGame,
  { label: string; targetSize: number; capacity: number; preset: GamePoolPreset }
> = {
  "same-brain": {
    label: "same brain",
    targetSize: 8,
    capacity: 16,
    preset: {
      game: "same-brain",
      rounds: 8,
      scoring: "embedding",
      sayItAloud: true,
      eliminateOddOne: false,
    },
  },
  liars: {
    label: "liars",
    targetSize: 9,
    capacity: 16,
    preset: {
      game: "liars",
      mode: "mafia",
      roomMode: "same-room",
      firstGame: true,
      blindImposters: false,
      wordBoard: true,
    },
  },
  centre: {
    label: "centre",
    targetSize: 6,
    capacity: 8,
    preset: { game: "centre", difficulty: 3, delayedRivals: false },
  },
  twin: {
    label: "twin",
    targetSize: 6,
    capacity: 12,
    preset: { game: "twin", handSize: 8 },
  },
  "draw-country": {
    label: "draw the country",
    targetSize: 8,
    capacity: 16,
    preset: { game: "draw-country", drawSeconds: 45, roundTotal: 5 },
  },
};

export function isGamePoolGame(value: unknown): value is GamePoolGame {
  return GAME_POOL_GAMES.includes(value as GamePoolGame);
}

export function gamePoolPreset(value: unknown, game: GamePoolGame): GamePoolPreset {
  const fallback = GAME_POOL_DEFAULTS[game].preset;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  if (record.game !== game) return fallback;

  if (game === "same-brain")
    return {
      game,
      rounds: boundedInteger(record.rounds, 3, 20, 8),
      scoring: record.scoring === "exact" ? "exact" : "embedding",
      sayItAloud: record.sayItAloud !== false,
      eliminateOddOne: record.eliminateOddOne === true,
    };
  if (game === "liars")
    return {
      game,
      mode: record.mode === "imposter" ? "imposter" : "mafia",
      roomMode: record.roomMode === "remote" ? "remote" : "same-room",
      firstGame: record.firstGame !== false,
      blindImposters: record.blindImposters === true,
      wordBoard: record.wordBoard !== false,
    };
  if (game === "centre")
    return {
      game,
      difficulty: boundedInteger(record.difficulty, 1, 5, 3) as 1 | 2 | 3 | 4 | 5,
      delayedRivals: record.delayedRivals === true,
    };
  if (game === "twin") return { game, handSize: boundedInteger(record.handSize, 3, 20, 8) };
  return {
    game,
    drawSeconds: boundedInteger(record.drawSeconds, 15, 120, 45),
    roundTotal: boundedInteger(record.roundTotal, 1, 12, 5),
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}
