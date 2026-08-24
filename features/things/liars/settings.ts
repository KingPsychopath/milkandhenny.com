import type { LiarsMode, LiarsRoomMode } from "./types";

export interface LiarsGameSettings {
  game: "liars";
  mode: LiarsMode;
  roomMode: LiarsRoomMode;
  firstGame: boolean;
  blindImposters: boolean;
  wordBoard: boolean;
}

export const LIARS_GAME_SETTINGS: LiarsGameSettings = {
  game: "liars",
  mode: "mafia",
  roomMode: "same-room",
  firstGame: false,
  blindImposters: false,
  wordBoard: true,
};

export function parseLiarsGameSettings(value: unknown): LiarsGameSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Liars settings are missing.");
  const input = value as Record<string, unknown>;
  if (input.game !== "liars") throw new Error("These are not Liars settings.");
  if (input.mode !== "mafia" && input.mode !== "imposter")
    throw new Error("Choose Mafia or Imposter.");
  if (input.roomMode !== "same-room" && input.roomMode !== "remote")
    throw new Error("Choose same-room or remote play.");
  if (
    typeof input.firstGame !== "boolean" ||
    typeof input.blindImposters !== "boolean" ||
    typeof input.wordBoard !== "boolean"
  )
    throw new Error("The Liars game options must be true or false.");
  return {
    game: "liars",
    mode: input.mode,
    roomMode: input.roomMode,
    firstGame: input.firstGame,
    blindImposters: input.blindImposters,
    wordBoard: input.wordBoard,
  };
}
