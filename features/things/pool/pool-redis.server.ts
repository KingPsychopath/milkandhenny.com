import { getCommandRedis, getDirectRedisConfig } from "@/lib/platform/redis-direct.server";
import { getRedis } from "@/lib/platform/redis.server";

function directRedis() {
  return getDirectRedisConfig() ? getCommandRedis() : null;
}

export async function getPoolValue<T>(key: string): Promise<T | null> {
  const rest = getRedis();
  if (rest) return (await rest.get<T>(key)) ?? null;

  const raw = await directRedis()?.get(key);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

export async function setPoolValue(key: string, value: unknown, ttlSeconds: number) {
  const rest = getRedis();
  if (rest) {
    await rest.set(key, value, { ex: ttlSeconds });
    return;
  }

  const direct = directRedis();
  if (!direct) throw new Error("Game-night rooms require Redis.");
  await direct.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function deletePoolValues(...keys: string[]) {
  if (keys.length === 0) return;
  const rest = getRedis();
  if (rest) {
    await rest.del(...keys);
    return;
  }
  await directRedis()?.del(...keys);
}
