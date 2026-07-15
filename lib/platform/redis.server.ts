import { Redis } from "@upstash/redis";

/**
 * Shared Redis REST client.
 *
 * REDIS_REST_* is the provider-neutral application contract. The Upstash and
 * Vercel KV names remain temporary migration aliases so the old deployment can
 * be used as a rollback target during the Railway cutover.
 */
type RedisRestConfig = {
  url: string;
  token: string;
  source: "REDIS_REST_*" | "UPSTASH_REDIS_REST_*" | "KV_REST_API_*";
};

export function getRedisRestConfig(): RedisRestConfig | null {
  const candidates = [
    {
      url: process.env.REDIS_REST_URL,
      token: process.env.REDIS_REST_TOKEN,
      source: "REDIS_REST_*" as const,
    },
    {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      source: "UPSTASH_REDIS_REST_*" as const,
    },
    {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
      source: "KV_REST_API_*" as const,
    },
  ];

  const config = candidates.find(({ url, token }) => url?.trim() && token?.trim());
  if (!config?.url || !config.token) return null;
  return { url: config.url, token: config.token, source: config.source };
}

export function getRedis(): Redis | null {
  const config = getRedisRestConfig();
  return config ? new Redis({ url: config.url, token: config.token }) : null;
}
