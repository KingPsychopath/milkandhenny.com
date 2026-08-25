import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";

import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import type { OfficialGameResultDraft, OfficialGameResultEnvelope } from "./official-game-results";

const OUTBOX_PREFIX = "things:official-result-outbox";

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
    players: input.players,
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

async function deliver(key: string, envelope: OfficialGameResultEnvelope) {
  const { ingestOfficialGameResult, processOfficialGameResult } =
    await import("@/features/event-scoring/games.server");
  const ingested = await ingestOfficialGameResult(envelope);
  if (!ingested.ok) {
    if (ingested.status === 409) {
      await getRedis()?.del(key);
      return true;
    }
    return false;
  }
  await getRedis()?.del(key);
  if (!ingested.value.duplicate) await processOfficialGameResult(ingested.value.id);
  return true;
}

export function deliverOfficialResultsAfterCommit(
  queued: Array<{ key: string; envelope: OfficialGameResultEnvelope }>,
) {
  for (const item of queued) {
    void deliver(item.key, item.envelope).catch((error) => {
      log.error(
        "things.official-game-results",
        "Official game result delivery failed",
        { key: item.key },
        error,
      );
    });
  }
}

export async function drainOfficialGameResultOutbox(limit = 50): Promise<{
  selected: number;
  delivered: number;
}> {
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
    if (await deliver(key, envelope)) delivered += 1;
  }
  return { selected: keys.length, delivered };
}
