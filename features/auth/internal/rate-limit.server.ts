import { getRedis } from "@/lib/platform/redis.server";
import type { AuthRole } from "./token-session.server";

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 900;
export const memoryRateLimit = new Map<string, { attempts: number; resetAtMs: number }>();

export const RESERVE_RATE_LIMIT_SCRIPT = `
local identity = redis.call("INCR", KEYS[1])
if identity == 1 then redis.call("EXPIRE", KEYS[1], ARGV[3]) end
local global = redis.call("INCR", KEYS[2])
if global == 1 then redis.call("EXPIRE", KEYS[2], ARGV[3]) end
local allowed = 1
if identity > tonumber(ARGV[1]) or global > tonumber(ARGV[2]) then allowed = 0 end
local remaining = tonumber(ARGV[1]) - identity
if remaining < 0 then remaining = 0 end
local retry = redis.call("TTL", KEYS[1])
return { allowed, remaining, retry }
`;

export const RESERVE_STEP_UP_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
if attempts == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
local allowed = attempts <= tonumber(ARGV[1]) and 1 or 0
local remaining = tonumber(ARGV[1]) - attempts
if remaining < 0 then remaining = 0 end
local retry = redis.call("TTL", KEYS[1])
return { allowed, remaining, retry }
`;

export function memoryKey(role: AuthRole, ip: string): string {
  return `mem:${role}:${ip}`;
}

export async function checkRateLimit(
  role: AuthRole,
  ip: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    // In-memory fallback: good enough for local dev and prevents accidental brute force.
    const key = memoryKey(role, ip);
    const now = Date.now();
    const entry = memoryRateLimit.get(key);
    const fresh =
      !entry || entry.resetAtMs <= now
        ? { attempts: 0, resetAtMs: now + LOCKOUT_SECONDS * 1000 }
        : entry;
    fresh.attempts += 1;
    memoryRateLimit.set(key, fresh);

    if (fresh.attempts > MAX_ATTEMPTS) {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    return {
      allowed: true,
      remaining: Math.max(0, MAX_ATTEMPTS - fresh.attempts),
      backendAvailable: false,
    };
  }

  const key = `auth:ratelimit:${role}:${ip}`;
  const globalKey = `auth:ratelimit:${role}:global`;
  try {
    const result = (await redis.eval<number[]>(
      RESERVE_RATE_LIMIT_SCRIPT,
      [key, globalKey],
      [MAX_ATTEMPTS, MAX_ATTEMPTS * 20, LOCKOUT_SECONDS],
    )) as number[];
    return {
      allowed: Number(result?.[0]) === 1,
      remaining: Math.max(0, Number(result?.[1]) || 0),
      backendAvailable: true,
    };
  } catch {
    return { allowed: false, remaining: 0, backendAvailable: false };
  }
}

export async function clearRateLimit(role: AuthRole, ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryRateLimit.delete(memoryKey(role, ip));
    return;
  }
  await redis.del(`auth:ratelimit:${role}:${ip}`);
}

export function stepUpRateLimitKey(parentJti: string): string {
  return `auth:step-up-ratelimit:${parentJti}`;
}

export async function reserveStepUpAttempt(
  parentJti: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const redis = getRedis();
  const key = stepUpRateLimitKey(parentJti);
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    const entry = memoryRateLimit.get(`mem:${key}`);
    const now = Date.now();
    const fresh =
      !entry || entry.resetAtMs <= now
        ? { attempts: 0, resetAtMs: now + LOCKOUT_SECONDS * 1000 }
        : entry;
    fresh.attempts += 1;
    memoryRateLimit.set(`mem:${key}`, fresh);
    return {
      allowed: fresh.attempts <= MAX_ATTEMPTS,
      remaining: Math.max(0, MAX_ATTEMPTS - fresh.attempts),
      backendAvailable: false,
    };
  }
  try {
    const result = (await redis.eval<number[]>(
      RESERVE_STEP_UP_SCRIPT,
      [key],
      [MAX_ATTEMPTS, LOCKOUT_SECONDS],
    )) as number[];
    return {
      allowed: Number(result?.[0]) === 1,
      remaining: Math.max(0, Number(result?.[1]) || 0),
      backendAvailable: true,
    };
  } catch {
    return { allowed: false, remaining: 0, backendAvailable: false };
  }
}

export async function clearStepUpFailures(parentJti: string): Promise<void> {
  const redis = getRedis();
  const key = stepUpRateLimitKey(parentJti);
  if (!redis) {
    memoryRateLimit.delete(`mem:${key}`);
    return;
  }
  await redis.del(key);
}

/* ─── Route guard ─── */

/**
 * Protect an API route. Returns null when authorized, or an error response.
 *
 * For admin/upload: Validates JWT (Authorization: Bearer <token>).
 * For cron: Validates Bearer secret directly.
 */
