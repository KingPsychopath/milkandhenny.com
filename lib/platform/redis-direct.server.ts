import Redis from "ioredis";

let commandRedis: Redis | null = null;

interface DirectRedisConfig {
  source: "REDIS_URL" | "UPSTASH_REDIS_URL" | "UPSTASH_REDIS_*";
  url: string;
}

function getDirectRedisConfig(): DirectRedisConfig | null {
  const explicitUrl = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_URL;
  if (explicitUrl)
    return {
      source: process.env.REDIS_URL ? "REDIS_URL" : "UPSTASH_REDIS_URL",
      url: explicitUrl,
    };

  const host = process.env.UPSTASH_REDIS_HOST ?? process.env.UPSTASH_REDIS_ENDPOINT;
  const port = process.env.UPSTASH_REDIS_PORT ?? "6379";
  const password = process.env.UPSTASH_REDIS_PASSWORD;
  const username = process.env.UPSTASH_REDIS_USERNAME;

  if (!host || !password) return null;

  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    : `:${encodeURIComponent(password)}`;

  return { source: "UPSTASH_REDIS_*", url: `rediss://${auth}@${host}:${port}` };
}

function getDirectRedisUrl(): string {
  const config = getDirectRedisConfig();
  if (config) return config.url;
  throw new Error(
    "Missing direct Redis env vars. Set REDIS_URL/UPSTASH_REDIS_URL or UPSTASH_REDIS_HOST, UPSTASH_REDIS_PORT, UPSTASH_REDIS_PASSWORD.",
  );
}

function createRedisClient(): Redis {
  return new Redis(getDirectRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

/**
 * A connection of your own. Needed for pub/sub: a subscribed client cannot run
 * ordinary commands, so it must not share with the queue clients.
 */
function createDirectRedisClient(): Redis {
  return createRedisClient();
}

function getCommandRedis(): Redis {
  if (!commandRedis) {
    commandRedis = createRedisClient();
  }
  return commandRedis;
}

async function closeDirectRedisConnections(): Promise<void> {
  const clients = [commandRedis].filter(Boolean) as Redis[];
  commandRedis = null;

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}

export {
  closeDirectRedisConnections,
  createDirectRedisClient,
  getCommandRedis,
  getDirectRedisConfig,
};
