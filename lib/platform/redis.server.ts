import { Redis } from "@upstash/redis";

/**
 * Shared Redis REST client.
 *
 * REDIS_REST_* is the provider-neutral application contract.
 */
type RedisRestConfig = {
  url: string;
  token: string;
  source: "REDIS_REST_*";
};

export function getRedisRestConfig(): RedisRestConfig | null {
  const url = process.env.REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN;
  if (!url?.trim() || !token?.trim()) return null;
  return { url, token, source: "REDIS_REST_*" };
}

export function getRedis(): Redis | null {
  const config = getRedisRestConfig();
  return config ? new Redis({ url: config.url, token: config.token }) : null;
}
