import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { EVENT_INDEX_KEY, eventMetaKey } from "./config.server";
import { isValidEventSlug, isPubliclyVisible, type EventRecord } from "./types";

/**
 * Event persistence.
 *
 * Redis is the source of truth. The in-memory map is a development
 * convenience only, matching the fail-closed posture described in
 * `docs/architecture.md`: production surfaces error rather than silently
 * serving an empty list.
 */

const memoryEvents = new Map<string, EventRecord>();

function isDevFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export class EventStoreUnavailableError extends Error {
  constructor() {
    super("Event storage is not configured");
    this.name = "EventStoreUnavailableError";
  }
}

function reviveEvent(value: unknown): EventRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<EventRecord>;
  if (typeof record.slug !== "string" || !isValidEventSlug(record.slug)) return null;
  if (typeof record.title !== "string" || typeof record.startsAt !== "string") return null;
  return {
    ...record,
    lineup: Array.isArray(record.lineup) ? record.lineup : [],
    ticketTypes: Array.isArray(record.ticketTypes) ? record.ticketTypes : [],
    waitlistEnabled: record.waitlistEnabled === true,
    transferable: record.transferable === true,
    timezone: typeof record.timezone === "string" ? record.timezone : "Europe/London",
  } as EventRecord;
}

export async function getEvent(slug: string): Promise<EventRecord | null> {
  if (!isValidEventSlug(slug)) return null;

  const redis = getRedis();
  if (!redis) {
    if (!isDevFallbackAllowed()) throw new EventStoreUnavailableError();
    return memoryEvents.get(slug) ?? null;
  }

  const raw = await redis.get<unknown>(eventMetaKey(slug));
  return reviveEvent(raw);
}

/**
 * Read many events by slug in one round trip.
 *
 * Used by the index page so listing N events costs one `mget`, not N gets.
 */
export async function getEvents(slugs: string[]): Promise<EventRecord[]> {
  const safe = slugs.filter(isValidEventSlug);
  if (safe.length === 0) return [];

  const redis = getRedis();
  if (!redis) {
    if (!isDevFallbackAllowed()) throw new EventStoreUnavailableError();
    return safe.map((slug) => memoryEvents.get(slug)).filter((e): e is EventRecord => Boolean(e));
  }

  const keys = safe.map(eventMetaKey);
  const raw = await redis.mget<unknown[]>(...keys);
  return (Array.isArray(raw) ? raw : [])
    .map(reviveEvent)
    .filter((event): event is EventRecord => Boolean(event));
}

export type ListEventsOptions = {
  /** Include drafts and archives. Admin surfaces only. */
  includeHidden?: boolean;
  limit?: number;
};

/**
 * All events, newest start first.
 *
 * The index is a sorted set scored by start time, so ordering is Redis's
 * job rather than a full scan plus sort in application code.
 */
export async function listEvents(options: ListEventsOptions = {}): Promise<EventRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const redis = getRedis();
  if (!redis) {
    if (!isDevFallbackAllowed()) throw new EventStoreUnavailableError();
    const all = [...memoryEvents.values()].sort(
      (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt),
    );
    const filtered = options.includeHidden ? all : all.filter(isPubliclyVisible);
    return filtered.slice(0, limit);
  }

  const slugs = await redis.zrange<string[]>(EVENT_INDEX_KEY, 0, limit - 1, { rev: true });
  const events = await getEvents(Array.isArray(slugs) ? slugs : []);
  return options.includeHidden ? events : events.filter(isPubliclyVisible);
}

export async function putEvent(event: EventRecord): Promise<void> {
  if (!isValidEventSlug(event.slug)) {
    throw new Error(`Refusing to store event with invalid slug: ${event.slug}`);
  }

  const score = Date.parse(event.startsAt);
  const safeScore = Number.isFinite(score) ? score : Date.now();

  const redis = getRedis();
  if (!redis) {
    if (!isDevFallbackAllowed()) throw new EventStoreUnavailableError();
    memoryEvents.set(event.slug, event);
    return;
  }

  const pipeline = redis.pipeline();
  pipeline.set(eventMetaKey(event.slug), event);
  pipeline.zadd(EVENT_INDEX_KEY, { score: safeScore, member: event.slug });
  await pipeline.exec();
}

export async function deleteEvent(slug: string): Promise<void> {
  if (!isValidEventSlug(slug)) return;

  const redis = getRedis();
  if (!redis) {
    if (!isDevFallbackAllowed()) throw new EventStoreUnavailableError();
    memoryEvents.delete(slug);
    return;
  }

  const pipeline = redis.pipeline();
  pipeline.del(eventMetaKey(slug));
  pipeline.zrem(EVENT_INDEX_KEY, slug);
  await pipeline.exec();
  log.info("events.delete", "Event deleted", { slug });
}

/** Test-only reset for the development in-memory store. */
export function __resetEventMemoryStore(): void {
  memoryEvents.clear();
}
