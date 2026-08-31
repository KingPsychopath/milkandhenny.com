import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";

import {
  createDirectRedisClient,
  getCommandRedis,
  getDirectRedisConfig,
} from "@/lib/platform/redis-direct.server";
import { log } from "@/lib/platform/logger.server";
import { getRedis } from "@/lib/platform/redis.server";
import { getRuntimeInstanceId } from "@/lib/platform/runtime-metadata.server";
import type { OfficialGameResultDraft, OfficialGameResultEnvelope } from "./types";
import {
  durableWorkSnapshot,
  DURABLE_WORK_LOG_SCOPE,
  type DurableWorkSnapshot,
} from "@/features/system/durable-work";

const OUTBOX_PREFIX = "things:official-result-outbox";
const WAKE_CHANNEL = "game-results:v1:wake";

export type OfficialResultConsumer = (envelope: OfficialGameResultEnvelope) => Promise<boolean>;
type WakeListener = (envelopes: readonly OfficialGameResultEnvelope[]) => void | Promise<void>;

const localListeners = new Set<WakeListener>();

function payloadWithoutHash(input: Omit<OfficialGameResultEnvelope, "payloadHash">) {
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    channelId: input.channelId,
    gameKind: input.gameKind,
    gameInstanceId: input.gameInstanceId,
    resultId: input.resultId,
    revision: input.revision,
    operation: input.operation,
    scope: input.scope,
    players: input.players.map((player) => ({
      playerId: player.playerId,
      outcome: player.outcome,
      rawScore: player.rawScore,
      placement: player.placement,
      durationMs: player.durationMs,
      won: player.won,
    })),
    committedAt: input.committedAt,
  });
}

export function officialResultPayloadHash(
  input: Omit<OfficialGameResultEnvelope, "payloadHash">,
): string {
  return createHash("sha256").update(payloadWithoutHash(input)).digest("hex");
}

export function sealOfficialGameResult(input: {
  channelId: string;
  revision: number;
  operation?: "record" | "cancel";
  result: OfficialGameResultDraft;
  committedAt?: string;
}): OfficialGameResultEnvelope {
  const unsigned = {
    ...input.result,
    schemaVersion: 1,
    channelId: input.channelId,
    revision: input.revision,
    operation: input.operation ?? "record",
    committedAt: input.committedAt ?? new Date().toISOString(),
  } as const;
  return { ...unsigned, payloadHash: officialResultPayloadHash(unsigned) };
}

function outboxKey(envelope: OfficialGameResultEnvelope) {
  return `${OUTBOX_PREFIX}:${envelope.channelId}:${envelope.resultId}:${envelope.revision}`;
}

export async function persistRoomWithOfficialResults(input: {
  redis: Redis;
  stateKey: string;
  room: unknown;
  ttlSeconds: number;
  envelopes: OfficialGameResultEnvelope[];
}): Promise<Array<{ key: string; envelope: OfficialGameResultEnvelope }>> {
  if (input.envelopes.length === 0) {
    await input.redis.set(input.stateKey, input.room, { ex: input.ttlSeconds });
    return [];
  }
  const queued = input.envelopes.map((envelope) => ({ key: outboxKey(envelope), envelope }));
  const multi = input.redis.multi();
  multi.set(input.stateKey, input.room, { ex: input.ttlSeconds });
  for (const item of queued) multi.set(item.key, item.envelope, { ex: input.ttlSeconds });
  await multi.exec();
  return queued;
}

/**
 * Wake delivery is advisory. The durable Redis outbox remains authoritative and
 * cron drains it if a process exits or a pub/sub message is missed.
 */
export function publishOfficialResultsAfterCommit(
  queued: readonly { key: string; envelope: OfficialGameResultEnvelope }[],
): void {
  if (queued.length === 0) return;
  const envelopes = queued.map(({ envelope }) => envelope);
  queueMicrotask(() => {
    for (const listener of localListeners) {
      void Promise.resolve(listener(envelopes)).catch((error: unknown) => {
        log.error(
          DURABLE_WORK_LOG_SCOPE.officialGameResults,
          "Local advisory wake failed",
          undefined,
          error,
        );
      });
    }
  });
  if (!getDirectRedisConfig()) return;
  void getCommandRedis()
    .publish(WAKE_CHANNEL, JSON.stringify({ origin: getRuntimeInstanceId() }))
    .catch((error: unknown) => {
      log.warn(DURABLE_WORK_LOG_SCOPE.officialGameResults, "Redis advisory wake failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Subscribe at the application composition edge, never from a game module. */
export function subscribeOfficialResultWake(listener: WakeListener): () => Promise<void> {
  localListeners.add(listener);
  const config = getDirectRedisConfig();
  if (!config) {
    return async () => {
      localListeners.delete(listener);
    };
  }

  const origin = getRuntimeInstanceId();
  const subscriber = createDirectRedisClient();
  subscriber.on("message", (_channel, raw) => {
    try {
      const message: unknown = JSON.parse(raw);
      if (
        message &&
        typeof message === "object" &&
        !Array.isArray(message) &&
        (message as { origin?: unknown }).origin !== origin
      ) {
        void Promise.resolve(listener([])).catch((error: unknown) => {
          log.error(
            DURABLE_WORK_LOG_SCOPE.officialGameResults,
            "Redis advisory wake consumer failed",
            undefined,
            error,
          );
        });
      }
    } catch {
      log.warn(DURABLE_WORK_LOG_SCOPE.officialGameResults, "Ignored an invalid advisory wake");
    }
  });
  subscriber.on("error", (error) => {
    log.warn(DURABLE_WORK_LOG_SCOPE.officialGameResults, "Redis wake subscriber failed", {
      error: error.message,
    });
  });
  void subscriber.subscribe(WAKE_CHANNEL).catch((error: unknown) => {
    log.error(
      DURABLE_WORK_LOG_SCOPE.officialGameResults,
      "Redis wake subscription failed",
      undefined,
      error,
    );
  });

  return async () => {
    localListeners.delete(listener);
    await subscriber.quit().catch(() => undefined);
    subscriber.disconnect();
  };
}

async function consumeOutboxItem(
  key: string,
  envelope: OfficialGameResultEnvelope,
  consumer: OfficialResultConsumer,
): Promise<boolean> {
  const consumed = await consumer(envelope);
  if (consumed) await getRedis()?.del(key);
  return consumed;
}

export async function drainOfficialGameResultOutbox(
  consumer: OfficialResultConsumer,
  limit = 50,
): Promise<{ selected: number; delivered: number }> {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") throw new Error("Official results require Redis");
    return { selected: 0, delivered: 0 };
  }
  const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
  const keys: string[] = [];
  let cursor = "0";
  do {
    const scanResult: [string, string[]] = await redis.scan(cursor, {
      match: `${OUTBOX_PREFIX}:*`,
      count: Math.min(100, bounded - keys.length),
    });
    const [nextCursor, page] = scanResult;
    cursor = nextCursor;
    keys.push(...page.slice(0, bounded - keys.length));
  } while (String(cursor) !== "0" && keys.length < bounded);
  let delivered = 0;
  for (const key of keys) {
    const envelope = await redis.get<OfficialGameResultEnvelope>(key);
    if (!envelope) continue;
    try {
      if (await consumeOutboxItem(key, envelope, consumer)) delivered += 1;
    } catch (error) {
      log.error(
        DURABLE_WORK_LOG_SCOPE.officialGameResults,
        "Official result delivery failed",
        { key },
        error,
      );
    }
  }
  return { selected: keys.length, delivered };
}

export async function consumeOfficialResultWake(
  envelopes: readonly OfficialGameResultEnvelope[],
  consumer: OfficialResultConsumer,
): Promise<{ selected: number; delivered: number }> {
  if (getRedis()) return drainOfficialGameResultOutbox(consumer);
  let delivered = 0;
  for (const envelope of envelopes) if (await consumer(envelope)) delivered += 1;
  return { selected: envelopes.length, delivered };
}

export async function describeOfficialGameResultOutbox(): Promise<{
  durableWork: DurableWorkSnapshot;
}> {
  const redis = getRedis();
  if (!redis)
    return {
      durableWork: durableWorkSnapshot({
        available: false,
        pending: 0,
        processing: 0,
        failed: 0,
        oldestPendingAt: null,
      }),
    };
  const envelopes: OfficialGameResultEnvelope[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys]: [string, string[]] = await redis.scan(cursor, {
      match: `${OUTBOX_PREFIX}:*`,
      count: 100,
    });
    cursor = nextCursor;
    if (keys.length > 0) {
      const values = await redis.mget<OfficialGameResultEnvelope[]>(...keys);
      envelopes.push(
        ...values.filter((value): value is OfficialGameResultEnvelope => value !== null),
      );
    }
  } while (String(cursor) !== "0");
  const oldestPendingAt = envelopes.reduce<string | null>((oldest, envelope) => {
    if (!oldest || Date.parse(envelope.committedAt) < Date.parse(oldest))
      return envelope.committedAt;
    return oldest;
  }, null);
  return {
    durableWork: durableWorkSnapshot({
      available: true,
      pending: envelopes.length,
      processing: 0,
      failed: 0,
      oldestPendingAt,
    }),
  };
}
