import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";

export interface PairsRaceSession {
  roomId: string;
  playerId: string;
  playerToken: string;
  expiresAt: number;
}
export function savePairsRaceSession(session: PairsRaceSession, pending = false) {
  return writeExpiringLocalValue(
    `things:pairs:race:${session.roomId}${pending ? ":join" : ""}`,
    session,
    session.expiresAt,
  );
}
export function loadPairsRaceSession(roomId: string, pending = false): PairsRaceSession | null {
  const value = readExpiringLocalValue<unknown>(
    `things:pairs:race:${roomId}${pending ? ":join" : ""}`,
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("roomId" in value) ||
    value.roomId !== roomId ||
    !("playerId" in value) ||
    typeof value.playerId !== "string" ||
    !("playerToken" in value) ||
    typeof value.playerToken !== "string" ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "number"
  )
    return null;
  return {
    roomId,
    playerId: value.playerId,
    playerToken: value.playerToken,
    expiresAt: value.expiresAt,
  };
}
