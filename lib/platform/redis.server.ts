import { Redis } from "@upstash/redis";
import { currentOperationSignal } from "./operation-context.server";
import { currentRedisProvider } from "./redis-provider-context.server";

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
  const provider = currentRedisProvider();
  if (provider) return provider.client;
  const config = getRedisRestConfig();
  return config
    ? new Redis({
        url: config.url,
        token: config.token,
        // The SDK accepts a function so one cached client can follow each Effect operation.
        signal: () => currentOperationSignal() ?? new AbortController().signal,
      })
    : null;
}
