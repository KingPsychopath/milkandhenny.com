import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { MULTIPLAYER_ROOM_ALPHABET, MULTIPLAYER_ROOM_ID_LENGTH } from "./multiplayer";
import type { MultiplayerJoinAttempt } from "./multiplayer";

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

export type MultiplayerJoinAttemptResolution<Player> =
  | { kind: "conflict" }
  | { kind: "new"; joinId?: string; playerToken: string }
  | { kind: "retry"; player: Player; playerToken: string };

/**
 * Resolves a browser-generated join attempt without retaining a plaintext recovery credential on
 * the server. Existing clients remain compatible: without an attempt, the server creates a token
 * as before.
 */
export function resolveMultiplayerJoinAttempt<
  Player extends { joinId?: string; tokenHash: string },
>(
  players: readonly Player[],
  attempt?: MultiplayerJoinAttempt,
): MultiplayerJoinAttemptResolution<Player> {
  if (!attempt) return { kind: "new", playerToken: createMultiplayerCredential() };
  const existing = players.find(({ joinId }) => joinId === attempt.joinId);
  if (!existing)
    return {
      kind: "new",
      joinId: attempt.joinId,
      playerToken: attempt.playerToken,
    };
  return multiplayerCredentialsMatch(attempt.playerToken, existing.tokenHash)
    ? { kind: "retry", player: existing, playerToken: attempt.playerToken }
    : { kind: "conflict" };
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

export function multiplayerRoomExpired(expiresAt: number, now = Date.now()) {
  return expiresAt <= now;
}

export function remainingMultiplayerRoomTtlSeconds(expiresAt: number, now = Date.now()) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
}

/** Snapshot reads may acquire a lock to advance a timed room, but unchanged state needs no write. */
export function multiplayerRoomStateChanged(before: string, room: unknown) {
  return before !== JSON.stringify(room);
}

/**
 * A mutation normally finishes in milliseconds, but Redis and official-result persistence can
 * briefly run long during a provider or deployment wobble. The lease is renewed while work is in
 * flight; fifteen seconds is also long enough that a single delayed renewal cannot let a second
 * writer enter a still-running mutation.
 */
const ROOM_LOCK_TTL_MS = 15_000;
const ROOM_LOCK_RENEW_INTERVAL_MS = 5_000;
const ROOM_LOCK_RENEW_RETRY_MS = 500;
const ROOM_LOCK_ATTEMPTS = 12;
const ROOM_LOCK_RETRY_BASE_MS = 20;
const ROOM_LOCK_RETRY_JITTER_MS = 25;

/** Releases only our own lock, so a lock that already expired is never stolen from its new owner. */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

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
  let stopped = false;
  let leaseLost = false;
  let leaseValidUntil = performance.now() + ROOM_LOCK_TTL_MS;
  let renewalTimer: ReturnType<typeof setTimeout> | null = null;
  let renewalPromise = Promise.resolve();

  const scheduleRenewal = (delayMs = ROOM_LOCK_RENEW_INTERVAL_MS) => {
    if (stopped || leaseLost) return;
    renewalTimer = setTimeout(() => {
      renewalTimer = null;
      renewalPromise = renewLease();
    }, delayMs);
    renewalTimer.unref?.();
  };
  const renewLease = async (): Promise<void> => {
    try {
      const renewed = Number(
        await redis.eval(RENEW_LOCK_SCRIPT, [input.lockKey], [owner, String(ROOM_LOCK_TTL_MS)]),
      );
      if (renewed !== 1) {
        leaseLost = true;
        return;
      }
      leaseValidUntil = performance.now() + ROOM_LOCK_TTL_MS;
      scheduleRenewal();
    } catch {
      if (performance.now() >= leaseValidUntil) {
        leaseLost = true;
        return;
      }
      scheduleRenewal(ROOM_LOCK_RENEW_RETRY_MS);
    }
  };

  scheduleRenewal();
  let leaseInvalid = false;
  let result!: T;
  try {
    result = await use();
  } finally {
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    await renewalPromise.catch(() => undefined);
    leaseInvalid = leaseLost || performance.now() >= leaseValidUntil;
    // A failed release leaves only this short lease behind. It must not turn an already-committed,
    // idempotent action into an apparent failure that encourages unnecessary retries.
    await redis.eval(RELEASE_LOCK_SCRIPT, [input.lockKey], [owner]).catch(() => undefined);
  }
  // A renewal already in flight can be the first proof that ownership was lost. Check after it
  // settles, not only when guarded work returns, or stale work could appear successful.
  if (leaseInvalid) throw new MultiplayerRoomBusyError(input.roomId);
  return result;
}

/**
 * The development-only room store.
 *
 * Without Redis the games keep rooms in a module-level Map, and in dev that quietly breaks the
 * realtime sockets: Vite runs server functions and Nitro's websocket handlers in separate module
 * graphs, so each gets its own empty Map. A room created by a server function is invisible to the
 * socket, which then rejects every hello as unauthorised. Every multiplayer game here showed
 * "offline" in dev for that reason while being correct in production.
 *
 * Hanging the Map off `globalThis` gives both graphs the same store. Production fails closed
 * before it ever reaches this — the engines require Redis there.
 */
export function createMemoryRoomStore<Value>(namespace: string): Map<string, Value> {
  const key = `__milkandhenny_memory_rooms__${namespace}`;
  const holder = globalThis as Record<string, unknown>;
  holder[key] ??= new Map<string, Value>();
  return holder[key] as Map<string, Value>;
}

type MemoryRoomSweep = (now: number) => void;

interface MemoryRoomSweeperRegistry {
  sweepers: Map<string, MemoryRoomSweep>;
  timer?: ReturnType<typeof setInterval>;
}

const MEMORY_ROOM_SWEEPER_KEY = "__milkandhenny_memory_room_sweepers__";
const MEMORY_ROOM_SWEEP_INTERVAL_MS = 60_000;

function memoryRoomSweeperRegistry() {
  const holder = globalThis as Record<string, unknown>;
  holder[MEMORY_ROOM_SWEEPER_KEY] ??= {
    sweepers: new Map<string, MemoryRoomSweep>(),
  } satisfies MemoryRoomSweeperRegistry;
  return holder[MEMORY_ROOM_SWEEPER_KEY] as MemoryRoomSweeperRegistry;
}

/** Registers development-only cleanup for a memory-backed room namespace. */
export function registerMemoryRoomSweeper(namespace: string, sweep: MemoryRoomSweep) {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return;
  memoryRoomSweeperRegistry().sweepers.set(namespace, sweep);
}

export function sweepMemoryRoomStores(now = Date.now()) {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return;
  for (const sweep of memoryRoomSweeperRegistry().sweepers.values()) sweep(now);
}

/** Starts one process-local timer. The registry survives Vite's duplicate server module graphs. */
export function startMemoryRoomSweeper() {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return;
  const registry = memoryRoomSweeperRegistry();
  if (registry.timer) return;
  sweepMemoryRoomStores();
  registry.timer = setInterval(() => sweepMemoryRoomStores(), MEMORY_ROOM_SWEEP_INTERVAL_MS);
  registry.timer.unref?.();
}

export function stopMemoryRoomSweeper() {
  const registry = memoryRoomSweeperRegistry();
  if (!registry.timer) return;
  clearInterval(registry.timer);
  registry.timer = undefined;
}

/**
 * A digest of a redacted snapshot, so an unchanged room costs a few bytes instead of a few
 * kilobytes.
 *
 * Every room game already accepted a `lastSequence` on its read and not one of them ever looked at
 * it, so every poll re-sent a byte-identical snapshot: measured at 4.3 KB for a sixteen-player
 * liars room, ten times a minute, per phone.
 *
 * A digest rather than that sequence, for one specific reason. `connected` is derived from how long
 * ago somebody was last seen, not from anything that writes to the room, so a sequence comparison
 * would have frozen the presence dots on every screen until an unrelated write happened to bump it.
 * Hashing what the viewer would actually receive changes exactly when their view changes, whatever
 * caused it.
 *
 * `serverNow` is stripped before hashing, because it moves on every read by definition and would
 * make the digest useless. The clock offset it feeds is sent back on its own instead.
 *
 * The first 96 bits of SHA-256 keep the token short while making an accidental collision
 * negligible. This is not a security boundary; it only identifies a view the client already has.
 */
export function multiplayerSnapshotDigest(snapshot: unknown): string {
  const json = JSON.stringify(snapshot, (key, value: unknown) =>
    key === "serverNow" ? undefined : value,
  );
  return createHash("sha256").update(json).digest("base64url").slice(0, 16);
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
