import type { GamePoolGame } from "./types";

export type GamePoolJoinChoice = "auto" | "new" | { roomId: string };

export function requestedGamePoolChoice(
  requestedRoomId: string | undefined,
  targetRejected: boolean,
): GamePoolJoinChoice {
  return requestedRoomId && !targetRejected ? { roomId: requestedRoomId } : "auto";
}

function explicitMove(input: {
  requestedRoomId?: string;
  targetRejected: boolean;
  choice: GamePoolJoinChoice;
}) {
  return Boolean(
    input.requestedRoomId ||
    input.targetRejected ||
    input.choice === "new" ||
    typeof input.choice === "object",
  );
}

export function shouldReturnToExistingGamePoolRoom(input: {
  activeRoomId: string | null;
  requestedRoomId?: string;
  targetRejected: boolean;
  choice: GamePoolJoinChoice;
}) {
  return Boolean(input.activeRoomId && input.choice === "auto" && !explicitMove(input));
}

export function shouldReplaceExistingGamePoolRoom(input: {
  activeRoomId: string | null;
  requestedRoomId?: string;
  targetRejected: boolean;
  choice: GamePoolJoinChoice;
}) {
  if (!explicitMove(input)) return false;
  if (typeof input.choice === "object" && input.choice.roomId === input.activeRoomId) return false;
  return true;
}

export function gamePoolPlayerPath(game: GamePoolGame, roomId: string) {
  return `/things/${game}/${roomId}`;
}
