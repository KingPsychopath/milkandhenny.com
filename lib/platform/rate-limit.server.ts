import { getRedis } from "@/lib/platform/redis.server";

/**
 * Shared fixed-window rate limiter.
 *
 * One implementation for every throttle in the app: login attempts, step-up
 * attempts, share-link PINs, public form submissions. Each caller names its
 * limit; keys are namespaced so two features can never collide.
 *
 * Semantics are reserve-on-attempt: calling `reserveRateLimit` consumes one
 * attempt whether or not the guarded action later succeeds. Callers that
 * verify a credential should reserve first, then `clearRateLimit` on success
 * so legitimate users never accumulate failures.
 *
 * Backend posture follows the persistence rule in AGENTS.md: production
 * fails closed when Redis is unavailable (the guarded actions are the ones
 * worth protecting precisely when infrastructure is misbehaving); the
 * in-memory fallback exists for local development and tests only.
 */

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window expires. 0 when unknown. */
  retryAfterSeconds: number;
  backendAvailable: boolean;
};

export type RateLimitOptions = {
  /** Stable namespace for this limit, e.g. "auth:admin" or "marketing-subscribe". */
  name: string;
  /** The identity being limited — an IP, a session id, a share-link id. */
  identity: string;
  /** Attempts allowed per identity per window. */
  limit: number;
  windowSeconds: number;
  /** Optional cap across all identities, guarding against distributed abuse. */
  globalLimit?: number;
};

/** Counts the identity, and the shared window when a global cap applies. */
const RESERVE_SCRIPT = `
local identity = redis.call("INCR", KEYS[1])
if identity == 1 then redis.call("EXPIRE", KEYS[1], ARGV[3]) end
local allowed = 1
if identity > tonumber(ARGV[1]) then allowed = 0 end
if KEYS[2] then
  local global = redis.call("INCR", KEYS[2])
  if global == 1 then redis.call("EXPIRE", KEYS[2], ARGV[3]) end
  if global > tonumber(ARGV[2]) then allowed = 0 end
end
local remaining = tonumber(ARGV[1]) - identity
if remaining < 0 then remaining = 0 end
local retry = redis.call("TTL", KEYS[1])
if retry < 0 then retry = 0 end
return { allowed, remaining, retry }
`;

function identityKey(name: string, identity: string): string {
  return `ratelimit:${name}:${identity}`;
}

function globalKey(name: string): string {
  return `ratelimit:${name}:global`;
}

/* ─── In-memory fallback (development and tests only) ─── */

type MemoryWindow = { attempts: number; resetAtMs: number };

export const memoryWindows = new Map<string, MemoryWindow>();

function reserveInMemory(key: string, limit: number, windowSeconds: number): RateLimitDecision {
  const now = Date.now();
  const existing = memoryWindows.get(key);
  const window =
    !existing || existing.resetAtMs <= now
      ? { attempts: 0, resetAtMs: now + windowSeconds * 1000 }
      : existing;
  window.attempts += 1;
  memoryWindows.set(key, window);
  return {
    allowed: window.attempts <= limit,
    remaining: Math.max(0, limit - window.attempts),
    retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - now) / 1000)),
    backendAvailable: false,
  };
}

/** Consume one attempt. Fails closed in production when Redis is unavailable. */
export async function reserveRateLimit(options: RateLimitOptions): Promise<RateLimitDecision> {
  const { name, identity, limit, windowSeconds, globalLimit } = options;
  const key = identityKey(name, identity);

  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: windowSeconds,
        backendAvailable: false,
      };
    }
    const decision = reserveInMemory(key, limit, windowSeconds);
    if (globalLimit !== undefined && decision.allowed) {
      const global = reserveInMemory(globalKey(name), globalLimit, windowSeconds);
      if (!global.allowed) return { ...decision, allowed: false };
    }
    return decision;
  }

  try {
    const keys = globalLimit !== undefined ? [key, globalKey(name)] : [key];
    const result = (await redis.eval<number[]>(RESERVE_SCRIPT, keys, [
      limit,
      globalLimit ?? 0,
      windowSeconds,
    ])) as number[];
    return {
      allowed: Number(result?.[0]) === 1,
      remaining: Math.max(0, Number(result?.[1]) || 0),
      retryAfterSeconds: Math.max(0, Number(result?.[2]) || 0),
      backendAvailable: true,
    };
  } catch {
    // Redis is configured but unreachable: never fall back to unlimited.
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowSeconds,
      backendAvailable: false,
    };
  }
}

/** Forgive an identity's window — call after a successful verification. */
export async function clearRateLimit(name: string, identity: string): Promise<void> {
  const key = identityKey(name, identity);
  const redis = getRedis();
  if (!redis) {
    memoryWindows.delete(key);
    return;
  }
  try {
    await redis.del(key);
  } catch {
    // A failed clear only means the window expires on its own.
  }
}
