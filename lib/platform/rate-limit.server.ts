import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres-provider-context.server";
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
 * RATE_LIMIT_STORE=postgres selects the relational backend during migration.
 * The default Redis path remains until active windows are reconciled at cutover.
 * Production fails closed when the selected backend is unavailable; the
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

function postgresSelected(): boolean {
  return process.env.RATE_LIMIT_STORE === "postgres";
}

function rateSubjectHash(name: string, scope: "identity" | "global", identity: string): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Rate limit hash secret is unavailable");
  return createHmac("sha256", secret).update(`${name}\0${scope}\0${identity}`).digest("hex");
}

function validRateLimitOptions(options: RateLimitOptions): boolean {
  return (
    options.name.length > 0 &&
    options.name.length <= 120 &&
    options.identity.length > 0 &&
    Number.isInteger(options.limit) &&
    options.limit > 0 &&
    options.limit <= 2_147_483_647 &&
    Number.isInteger(options.windowSeconds) &&
    options.windowSeconds > 0 &&
    options.windowSeconds <= 90 * 86_400 &&
    (options.globalLimit === undefined ||
      (Number.isInteger(options.globalLimit) &&
        options.globalLimit > 0 &&
        options.globalLimit <= 2_147_483_647))
  );
}

async function reservePostgresWindow(
  client: PoolClient,
  name: string,
  scope: "identity" | "global",
  subjectHash: string,
  windowSeconds: number,
): Promise<{ attempts: number; retry_seconds: number }> {
  const result = await client.query<{ attempts: number; retry_seconds: number }>(
    `insert into rate_limit_windows as current_window
       (policy, scope, subject_hash, attempts, expires_at)
     values ($1, $2, $3, 1, clock_timestamp() + ($4::integer * interval '1 second'))
     on conflict (policy, scope, subject_hash) do update
       set attempts = case
             when current_window.expires_at <= clock_timestamp() then 1
             else current_window.attempts + 1
           end,
           expires_at = case
             when current_window.expires_at <= clock_timestamp()
             then clock_timestamp() + ($4::integer * interval '1 second')
             else current_window.expires_at
           end
     returning attempts,
       greatest(0, ceil(extract(epoch from expires_at - clock_timestamp()))::integer)
         as retry_seconds`,
    [name, scope, subjectHash, windowSeconds],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rate limit reservation returned no row");
  return row;
}

async function reserveInPostgres(options: RateLimitOptions): Promise<RateLimitDecision> {
  const { name, identity, limit, windowSeconds, globalLimit } = options;
  const identityHash = rateSubjectHash(name, "identity", identity);
  const globalHash =
    globalLimit === undefined ? null : rateSubjectHash(name, "global", "all-identities");
  return transaction(async (client) => {
    const individual = await reservePostgresWindow(
      client,
      name,
      "identity",
      identityHash,
      windowSeconds,
    );
    const global =
      globalHash === null
        ? null
        : await reservePostgresWindow(client, name, "global", globalHash, windowSeconds);
    const identityBlocked = individual.attempts > limit;
    const globalBlocked =
      global !== null && globalLimit !== undefined && global.attempts > globalLimit;
    return {
      allowed: !identityBlocked && !globalBlocked,
      remaining: Math.max(0, limit - individual.attempts),
      retryAfterSeconds:
        identityBlocked && globalBlocked
          ? Math.max(individual.retry_seconds, global.retry_seconds)
          : globalBlocked
            ? global.retry_seconds
            : individual.retry_seconds,
      backendAvailable: true,
    };
  });
}

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

  if (postgresSelected()) {
    if (validRateLimitOptions(options)) {
      try {
        return await reserveInPostgres(options);
      } catch {
        // A failed transaction is not an admission decision.
      }
    }
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowSeconds,
      backendAvailable: false,
    };
  }

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
  if (postgresSelected()) {
    try {
      const hash = rateSubjectHash(name, "identity", identity);
      await query(
        "delete from rate_limit_windows where policy = $1 and scope = 'identity' and subject_hash = $2",
        [name, hash],
      );
    } catch {
      // A failed clear leaves the protective window in place until expiry.
    }
    return;
  }
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

/** Bounded physical cleanup; expiry is enforced by reservation even if cleanup is delayed. */
export async function cleanupRateLimitWindows(
  batchSize = 1_000,
  maxBatches = 10,
): Promise<{ removed: number; batches: number }> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("Invalid rate-limit cleanup batch size");
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10) {
    throw new Error("Invalid rate-limit cleanup batch count");
  }
  let removed = 0;
  let batches = 0;
  for (; batches < maxBatches; batches += 1) {
    const rows = await query<{ removed: number }>(
      `with expired as (
         select ctid from rate_limit_windows
          where expires_at <= clock_timestamp()
          order by expires_at
          limit $1
          for update skip locked
       )
       delete from rate_limit_windows as windows
        using expired
        where windows.ctid = expired.ctid
       returning 1 as removed`,
      [batchSize],
    );
    removed += rows.length;
    if (rows.length < batchSize) {
      batches += 1;
      break;
    }
  }
  return { removed, batches };
}
