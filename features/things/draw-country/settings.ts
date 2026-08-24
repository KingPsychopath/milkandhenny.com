export interface DrawCountryGameSettings {
  game: "draw-country";
  drawSeconds: number;
  roundTotal: number;
}

export const DRAW_COUNTRY_GAME_SETTINGS: DrawCountryGameSettings = {
  game: "draw-country",
  drawSeconds: 30,
  roundTotal: 5,
};

export function parseDrawCountryGameSettings(value: unknown): DrawCountryGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Draw the Country settings are missing.");
  const input = value as Record<string, unknown>;
  if (input.game !== "draw-country") throw new Error("These are not Draw the Country settings.");
  if (
    typeof input.drawSeconds !== "number" ||
    !Number.isInteger(input.drawSeconds) ||
    input.drawSeconds < 15 ||
    input.drawSeconds > 90
  )
    throw new Error("Draw time must be between 15 and 90 seconds.");
  if (
    typeof input.roundTotal !== "number" ||
    !Number.isInteger(input.roundTotal) ||
    input.roundTotal < 1 ||
    input.roundTotal > 12
  )
    throw new Error("Draw the Country rounds must be between 1 and 12.");
  return {
    game: "draw-country",
    drawSeconds: input.drawSeconds,
    roundTotal: input.roundTotal,
  };
}
