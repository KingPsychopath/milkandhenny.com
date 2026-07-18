import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  MULTIPLAYER_ROOM_ALPHABET,
  MULTIPLAYER_ROOM_ID_LENGTH,
  MULTIPLAYER_ROOM_TTL_SECONDS,
} from "./multiplayer";

export function createMultiplayerCredential(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export function hashMultiplayerCredential(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function multiplayerCredentialsMatch(value: string, expectedHash: string, maxLength = 120) {
  if (!value || value.length > maxLength || expectedHash.length !== 64) return false;
  const actual = Buffer.from(hashMultiplayerCredential(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createMultiplayerRoomId() {
  return Array.from(
    { length: MULTIPLAYER_ROOM_ID_LENGTH },
    () => MULTIPLAYER_ROOM_ALPHABET[randomInt(MULTIPLAYER_ROOM_ALPHABET.length)],
  ).join("");
}

export async function createAvailableMultiplayerRoomId(
  roomExists: (roomId: string) => boolean | Promise<boolean>,
  attempts = 5,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const roomId = createMultiplayerRoomId();
    if (!(await roomExists(roomId))) return roomId;
  }
  throw new Error("Could not allocate room");
}

export function multiplayerRoomExpiresAt(now = Date.now()) {
  return now + MULTIPLAYER_ROOM_TTL_SECONDS * 1_000;
}

export function multiplayerRoomExpired(expiresAt: number, now = Date.now()) {
  return expiresAt <= now;
}

export function remainingMultiplayerRoomTtlSeconds(expiresAt: number, now = Date.now()) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
}

export function multiplayerActionSeen(processedActionIds: string[], actionId: string) {
  return processedActionIds.includes(actionId);
}

export function rememberMultiplayerAction(
  processedActionIds: string[],
  actionId: string,
  limit = 300,
) {
  return [...processedActionIds.filter((id) => id !== actionId), actionId].slice(-limit);
}
