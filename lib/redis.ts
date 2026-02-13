import { Redis } from '@upstash/redis';

/**
 * Shared Redis/KV client.
 *
 * Supports both Vercel KV (KV_REST_API_*) and direct Upstash
 * (UPSTASH_REDIS_*) env vars. Returns null when neither is configured
 * so callers can fall back to in-memory storage during local dev.
 */
export function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}
