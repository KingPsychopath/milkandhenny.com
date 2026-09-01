import { AsyncLocalStorage } from "node:async_hooks";
import type { Redis } from "@upstash/redis";

type RedisProviderOverride = { readonly client: Redis | null };

const activeRedisProvider = new AsyncLocalStorage<RedisProviderOverride>();

export function withRedisProvider<A>(client: Redis | null, run: () => Promise<A>): Promise<A> {
  return activeRedisProvider.run({ client }, run);
}

export function currentRedisProvider(): RedisProviderOverride | undefined {
  return activeRedisProvider.getStore();
}
