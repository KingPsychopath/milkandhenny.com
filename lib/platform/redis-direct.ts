import "server-only";

import Redis from "ioredis";

let blockingRedis: Redis | null = null;
let commandRedis: Redis | null = null;

function getDirectRedisUrl(): string {
  const explicitUrl = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_URL;
  if (explicitUrl) return explicitUrl;

  const host = process.env.UPSTASH_REDIS_HOST ?? process.env.UPSTASH_REDIS_ENDPOINT;
  const port = process.env.UPSTASH_REDIS_PORT ?? "6379";
  const password = process.env.UPSTASH_REDIS_PASSWORD;
  const username = process.env.UPSTASH_REDIS_USERNAME;

  if (!host || !password) {
    throw new Error(
      "Missing direct Redis env vars. Set REDIS_URL/UPSTASH_REDIS_URL or UPSTASH_REDIS_HOST, UPSTASH_REDIS_PORT, UPSTASH_REDIS_PASSWORD."
    );
  }

  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    : `:${encodeURIComponent(password)}`;

  return `rediss://${auth}@${host}:${port}`;
}

function createRedisClient(): Redis {
  return new Redis(getDirectRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

function getBlockingRedis(): Redis {
  if (!blockingRedis) {
    blockingRedis = createRedisClient();
  }
  return blockingRedis;
}

function getCommandRedis(): Redis {
  if (!commandRedis) {
    commandRedis = createRedisClient();
  }
  return commandRedis;
}

async function closeDirectRedisConnections(): Promise<void> {
  const clients = [blockingRedis, commandRedis].filter(Boolean) as Redis[];
  blockingRedis = null;
  commandRedis = null;

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    })
  );
}

export { closeDirectRedisConnections, getBlockingRedis, getCommandRedis };
