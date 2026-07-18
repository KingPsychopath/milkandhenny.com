import { MULTIPLAYER_ROOM_ID_PATTERN } from "./multiplayer";

export function multiplayerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

export function multiplayerText(value: unknown, max: number, error = "Invalid text") {
  if (typeof value !== "string" || value.length < 1 || value.length > max) throw new Error(error);
  return value;
}

export function optionalMultiplayerText(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

export function multiplayerRoomId(value: unknown) {
  const roomId = multiplayerText(value, 12, "Invalid room").toUpperCase();
  if (!MULTIPLAYER_ROOM_ID_PATTERN.test(roomId)) throw new Error("Invalid room");
  return roomId;
}

export function multiplayerCredential(value: unknown, max = 120) {
  return multiplayerText(value, max, "Invalid credential");
}

export function multiplayerSequence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
