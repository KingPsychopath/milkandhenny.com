import { MULTIPLAYER_ROOM_ID_PATTERN } from "./multiplayer";

export function multiplayerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return Object.fromEntries(Object.entries(value));
}

export function multiplayerBoundedText(
  value: unknown,
  max: number,
  error = "Invalid text",
) {
  if (typeof value !== "string" || value.length > max) throw new Error(error);
  return value;
}

export function multiplayerText(value: unknown, max: number, error = "Invalid text") {
  const text = multiplayerBoundedText(value, max, error);
  if (text.length < 1) throw new Error(error);
  return text;
}

export function optionalMultiplayerText(value: unknown, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Invalid text");
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > max) throw new Error("Invalid text");
  return text;
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
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error("Invalid sequence");
  return Math.floor(value);
}
