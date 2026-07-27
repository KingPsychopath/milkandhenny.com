import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import {
  ticketEmailIndexKey,
  ticketEventIndexKey,
  ticketMetaKey,
  ticketRedeemedKey,
  ticketTypeSoldKey,
} from "@/features/events/config.server";
import { isValidEventSlug } from "@/features/events/types";
import { isValidTicketId, type TicketRecord } from "./types";

/**
 * Ticket persistence.
 *
 * One Redis key per ticket. The door reads a single key per scan rather than
 * a whole-list key, which is the shape the guest-list postmortem calls for.
 * Tickets are receipts: nothing written here is ever given a TTL.
 */

const memoryTickets = new Map<string, TicketRecord>();
const memoryEventIndex = new Map<string, Set<string>>();
const memoryEmailIndex = new Map<string, Set<string>>();
const memoryRedeemed = new Map<string, string>();
const memorySold = new Map<string, Map<string, number>>();

function isDevFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export class TicketStoreUnavailableError extends Error {
  constructor() {
    super("Ticket storage is not configured");
    this.name = "TicketStoreUnavailableError";
  }
}

function requireRedisInProduction() {
  const redis = getRedis();
  if (!redis && !isDevFallbackAllowed()) throw new TicketStoreUnavailableError();
  return redis;
}

function reviveTicket(value: unknown): TicketRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<TicketRecord>;
  if (!isValidTicketId(record.id)) return null;
  if (typeof record.eventSlug !== "string" || !isValidEventSlug(record.eventSlug)) return null;
  if (typeof record.holderName !== "string") return null;
  return record as TicketRecord;
}

export async function getTicket(id: string): Promise<TicketRecord | null> {
  if (!isValidTicketId(id)) return null;
  const redis = requireRedisInProduction();
  if (!redis) return memoryTickets.get(id) ?? null;
  return reviveTicket(await redis.get<unknown>(ticketMetaKey(id)));
}

export async function getTickets(ids: string[]): Promise<TicketRecord[]> {
  const safe = ids.filter(isValidTicketId);
  if (safe.length === 0) return [];

  const redis = requireRedisInProduction();
  if (!redis) {
    return safe.map((id) => memoryTickets.get(id)).filter((t): t is TicketRecord => Boolean(t));
  }

  const raw = await redis.mget<unknown[]>(...safe.map(ticketMetaKey));
  return (Array.isArray(raw) ? raw : [])
    .map(reviveTicket)
    .filter((ticket): ticket is TicketRecord => Boolean(ticket));
}

/** Write the ticket and add it to every index it belongs to, in one round trip. */
export async function putTicket(ticket: TicketRecord): Promise<void> {
  if (!isValidTicketId(ticket.id)) throw new Error("Refusing to store a malformed ticket id");

  const redis = requireRedisInProduction();
  if (!redis) {
    memoryTickets.set(ticket.id, ticket);
    const eventSet = memoryEventIndex.get(ticket.eventSlug) ?? new Set<string>();
    eventSet.add(ticket.id);
    memoryEventIndex.set(ticket.eventSlug, eventSet);
    if (ticket.emailHash) {
      const key = `${ticket.eventSlug}:${ticket.emailHash}`;
      const emailSet = memoryEmailIndex.get(key) ?? new Set<string>();
      emailSet.add(ticket.id);
      memoryEmailIndex.set(key, emailSet);
    }
    return;
  }

  const pipeline = redis.pipeline();
  pipeline.set(ticketMetaKey(ticket.id), ticket);
  pipeline.sadd(ticketEventIndexKey(ticket.eventSlug), ticket.id);
  if (ticket.emailHash) {
    pipeline.sadd(ticketEmailIndexKey(ticket.eventSlug, ticket.emailHash), ticket.id);
  }
  await pipeline.exec();
}

export async function listTicketIdsForEvent(slug: string): Promise<string[]> {
  if (!isValidEventSlug(slug)) return [];
  const redis = requireRedisInProduction();
  if (!redis) return [...(memoryEventIndex.get(slug) ?? [])];
  const ids = await redis.smembers<string[]>(ticketEventIndexKey(slug));
  return Array.isArray(ids) ? ids.filter(isValidTicketId) : [];
}

export async function listTicketIdsForEmail(slug: string, emailHash: string): Promise<string[]> {
  if (!isValidEventSlug(slug) || !emailHash) return [];
  const redis = requireRedisInProduction();
  if (!redis) return [...(memoryEmailIndex.get(`${slug}:${emailHash}`) ?? [])];
  const ids = await redis.smembers<string[]>(ticketEmailIndexKey(slug, emailHash));
  return Array.isArray(ids) ? ids.filter(isValidTicketId) : [];
}

export type ClaimRedemptionResult = { claimed: true } | { claimed: false; redeemedAt: string };

/**
 * Atomically claim a ticket for entry.
 *
 * `SET NX` is the whole single-use guarantee: the first scanner to reach
 * Redis wins and every later scan — including a simultaneous one from a
 * second door device — reads back the winner's timestamp.
 */
export async function claimRedemption(
  id: string,
  redeemedAt: string,
): Promise<ClaimRedemptionResult> {
  if (!isValidTicketId(id)) return { claimed: false, redeemedAt };

  const redis = requireRedisInProduction();
  if (!redis) {
    const existing = memoryRedeemed.get(id);
    if (existing) return { claimed: false, redeemedAt: existing };
    memoryRedeemed.set(id, redeemedAt);
    return { claimed: true };
  }

  const result = await redis.set(ticketRedeemedKey(id), redeemedAt, { nx: true });
  if (result === "OK") return { claimed: true };

  const existing = await redis.get<string>(ticketRedeemedKey(id));
  return { claimed: false, redeemedAt: typeof existing === "string" ? existing : redeemedAt };
}

/** Undo a redemption. Staff-only: someone scanned the wrong person's phone. */
export async function releaseRedemption(id: string): Promise<void> {
  if (!isValidTicketId(id)) return;
  const redis = requireRedisInProduction();
  if (!redis) {
    memoryRedeemed.delete(id);
    return;
  }
  await redis.del(ticketRedeemedKey(id));
}

export async function getRedemptionAt(id: string): Promise<string | null> {
  if (!isValidTicketId(id)) return null;
  const redis = requireRedisInProduction();
  if (!redis) return memoryRedeemed.get(id) ?? null;
  const value = await redis.get<string>(ticketRedeemedKey(id));
  return typeof value === "string" ? value : null;
}

/**
 * Reserve one unit of a ticket type.
 *
 * Increment-then-check, so two concurrent buyers cannot both read the same
 * pre-increment count and oversell. A rejected reservation is rolled back.
 */
export async function reserveTicketType(
  slug: string,
  ticketTypeId: string,
  quantity: number,
): Promise<{ reserved: boolean; sold: number }> {
  const redis = requireRedisInProduction();
  if (!redis) {
    const counts = memorySold.get(slug) ?? new Map<string, number>();
    const next = (counts.get(ticketTypeId) ?? 0) + 1;
    if (next > quantity) return { reserved: false, sold: next - 1 };
    counts.set(ticketTypeId, next);
    memorySold.set(slug, counts);
    return { reserved: true, sold: next };
  }

  const next = await redis.hincrby(ticketTypeSoldKey(slug), ticketTypeId, 1);
  if (next > quantity) {
    await redis.hincrby(ticketTypeSoldKey(slug), ticketTypeId, -1);
    return { reserved: false, sold: next - 1 };
  }
  return { reserved: true, sold: next };
}

/** Release a reservation when issuance fails after the counter moved. */
export async function releaseTicketType(slug: string, ticketTypeId: string): Promise<void> {
  const redis = requireRedisInProduction();
  if (!redis) {
    const counts = memorySold.get(slug);
    if (counts) counts.set(ticketTypeId, Math.max(0, (counts.get(ticketTypeId) ?? 0) - 1));
    return;
  }
  try {
    await redis.hincrby(ticketTypeSoldKey(slug), ticketTypeId, -1);
  } catch (error) {
    log.error("tickets.release", "Failed to release reservation", { slug, ticketTypeId }, error);
  }
}

/** Test-only reset for the development in-memory store. */
export function __resetTicketMemoryStore(): void {
  memoryTickets.clear();
  memoryEventIndex.clear();
  memoryEmailIndex.clear();
  memoryRedeemed.clear();
  memorySold.clear();
}
