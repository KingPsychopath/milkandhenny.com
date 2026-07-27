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

/** Long enough to outlast the slowest room mutation (scoring a full lobby of drawings). */
const ROOM_LOCK_TTL_MS = 5_000;
const ROOM_LOCK_ATTEMPTS = 12;
const ROOM_LOCK_RETRY_BASE_MS = 20;
const ROOM_LOCK_RETRY_JITTER_MS = 25;

/** Releases only our own lock, so a lock that already expired is never stolen from its new owner. */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export interface MultiplayerLockAttempt {
  acquired: boolean;
  contended: boolean;
  waitMs: number;
}

interface MultiplayerRoomLockRedis {
  set: (key: string, value: string, options: { nx: true; px: number }) => Promise<unknown>;
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
}

export class MultiplayerRoomBusyError extends Error {
  constructor(roomId: string) {
    super(`Room ${roomId} is busy`);
    this.name = "MultiplayerRoomBusyError";
  }
}

/**
 * Hold a room's mutation lock for the duration of `use`. Every writer to a room takes this, so a
 * read-modify-write cycle cannot interleave with another player's action and lose an update.
 */
export async function withMultiplayerRoomLock<T>(
  redis: MultiplayerRoomLockRedis,
  input: { roomId: string; lockKey: string; onAttempt?: (attempt: MultiplayerLockAttempt) => void },
  use: () => Promise<T>,
): Promise<T> {
  const owner = createMultiplayerCredential();
  const startedAt = performance.now();
  let acquired = false;
  let contended = false;
  for (let attempt = 0; attempt < ROOM_LOCK_ATTEMPTS; attempt += 1) {
    acquired = Boolean(await redis.set(input.lockKey, owner, { nx: true, px: ROOM_LOCK_TTL_MS }));
    if (acquired) break;
    contended = true;
    await new Promise((resolve) =>
      setTimeout(resolve, ROOM_LOCK_RETRY_BASE_MS + randomInt(ROOM_LOCK_RETRY_JITTER_MS)),
    );
  }
  input.onAttempt?.({ acquired, contended, waitMs: performance.now() - startedAt });
  if (!acquired) throw new MultiplayerRoomBusyError(input.roomId);
  try {
    return await use();
  } finally {
    await redis.eval(RELEASE_LOCK_SCRIPT, [input.lockKey], [owner]);
  }
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
