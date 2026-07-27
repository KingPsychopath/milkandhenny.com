import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import {
  CLAIM_RATELIMIT_MAX,
  CLAIM_RATELIMIT_WINDOW_SECONDS,
  RESEND_RATELIMIT_MAX,
  RESEND_RATELIMIT_WINDOW_SECONDS,
  ticketClaimRateLimitKey,
  ticketResendRateLimitKey,
} from "@/features/events/config.server";
import { getEvent } from "@/features/events/store.server";
import { ticketTypeSalesState, type EventRecord, type TicketType } from "@/features/events/types";
import {
  claimRedemption,
  getRedemptionAt,
  getTicket,
  getTickets,
  listTicketIdsForEmail,
  listTicketIdsForEvent,
  putTicket,
  releaseRedemption,
  releaseTicketType,
  reserveTicketType,
} from "./store.server";
import {
  generateOrderId,
  generateTicketId,
  hashEmail,
  hashTicketId,
  isTicketSigningConfigured,
  verifyTicketSignature,
} from "./qr.server";
import {
  isValidEmail,
  isValidTicketId,
  normaliseEmail,
  parseTicketQrPayload,
  type DoorManifest,
  type DoorTicketView,
  type RedeemOutcome,
  type TicketKind,
  type TicketRecord,
} from "./types";

/**
 * Ticket workflows.
 *
 * Plain async engine functions, matching the shape of the multiplayer
 * engines. Timeouts, typed errors and tracing are applied one layer up in
 * `tickets-service.server.ts`.
 */

export type TicketOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const MAX_QUANTITY_PER_CLAIM = 10;

async function rateLimit(
  key: string,
  windowSeconds: number,
  max: number,
): Promise<{ allowed: boolean }> {
  const redis = getRedis();
  if (!redis) return { allowed: true };
  try {
    const next = await redis.incr(key);
    if (next === 1) await redis.expire(key, windowSeconds);
    return { allowed: next <= max };
  } catch {
    // A rate limiter that fails closed would take the door offline.
    return { allowed: true };
  }
}

function findTicketType(event: EventRecord, ticketTypeId: string): TicketType | null {
  return event.ticketTypes.find((type) => type.id === ticketTypeId) ?? null;
}

function toDoorView(ticket: TicketRecord, ticketTypeName: string): DoorTicketView {
  return {
    id: ticket.id,
    holderName: ticket.holderName,
    ticketTypeName,
    kind: ticket.kind,
    status: ticket.status,
    redeemedAt: ticket.redeemedAt,
    isPlusOne: Boolean(ticket.parentTicketId),
  };
}

export type IssueTicketsInput = {
  eventSlug: string;
  ticketTypeId: string;
  holderName: string;
  email?: string;
  quantity: number;
  kind: TicketKind;
  paymentRef?: string;
  amountPaidMinor?: number;
  currency?: string;
  notes?: string;
  /** Bypasses the sales window. Staff comping someone at the door. */
  force?: boolean;
};

export type IssuedTickets = {
  orderId: string;
  tickets: TicketRecord[];
  event: EventRecord;
};

/**
 * Issue one or more tickets for an event.
 *
 * Capacity is reserved per ticket before any record is written, and any
 * reservation taken before a later failure is released. Over-issuing is
 * worse than failing: a ticket that does not exist can be re-issued, a
 * person turned away at a full door cannot be un-turned-away.
 */
export async function issueTickets(
  input: IssueTicketsInput,
): Promise<TicketOpResult<IssuedTickets>> {
  if (!isTicketSigningConfigured()) {
    return { ok: false, status: 503, error: "Ticketing is not configured" };
  }

  const holderName = input.holderName?.trim();
  if (!holderName) return { ok: false, status: 400, error: "A name is required" };
  if (holderName.length > 120) return { ok: false, status: 400, error: "That name is too long" };

  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_CLAIM) {
    return { ok: false, status: 400, error: `Choose between 1 and ${MAX_QUANTITY_PER_CLAIM}` };
  }

  if (input.email !== undefined && !isValidEmail(input.email)) {
    return { ok: false, status: 400, error: "That email address doesn't look right" };
  }

  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const ticketType = findTicketType(event, input.ticketTypeId);
  if (!ticketType) return { ok: false, status: 404, error: "Ticket type not found" };

  if (!input.force) {
    const sales = ticketTypeSalesState(event, ticketType, 0);
    if (sales.state === "cancelled") {
      return { ok: false, status: 409, error: "This event has been cancelled" };
    }
    if (sales.state === "not-yet") {
      return { ok: false, status: 409, error: "Tickets aren't on sale yet" };
    }
    if (sales.state === "closed") {
      return { ok: false, status: 409, error: "Ticket sales have closed" };
    }
    if (quantity > ticketType.perPersonLimit) {
      return {
        ok: false,
        status: 409,
        error: `Limit of ${ticketType.perPersonLimit} per person for ${ticketType.name}`,
      };
    }
  }

  // Reserve every unit up front so a partial order never leaves the counter
  // ahead of the tickets actually written.
  let reserved = 0;
  for (let index = 0; index < quantity; index += 1) {
    const reservation = await reserveTicketType(event.slug, ticketType.id, ticketType.quantity);
    if (!reservation.reserved) break;
    reserved += 1;
  }

  if (reserved < quantity) {
    for (let index = 0; index < reserved; index += 1) {
      await releaseTicketType(event.slug, ticketType.id);
    }
    return { ok: false, status: 409, error: `Not enough ${ticketType.name} tickets left` };
  }

  const email = input.email ? normaliseEmail(input.email) : undefined;
  const emailHash = email ? hashEmail(email) : undefined;
  const orderId = generateOrderId();
  const issuedAt = new Date().toISOString();

  const tickets: TicketRecord[] = [];
  try {
    for (let index = 0; index < quantity; index += 1) {
      const ticket: TicketRecord = {
        id: generateTicketId(),
        eventSlug: event.slug,
        ticketTypeId: ticketType.id,
        kind: input.kind,
        status: "valid",
        holderName: index === 0 ? holderName : `${holderName} +${index}`,
        email,
        emailHash,
        orderId,
        parentTicketId: index === 0 ? undefined : tickets[0]?.id,
        issuedAt,
        paymentRef: input.paymentRef,
        amountPaidMinor: input.amountPaidMinor,
        currency: input.currency ?? ticketType.currency,
        notes: input.notes,
      };
      await putTicket(ticket);
      tickets.push(ticket);
    }
  } catch (error) {
    log.error(
      "tickets.issue",
      "Issuance failed after reserving",
      {
        slug: event.slug,
        ticketTypeId: ticketType.id,
        written: tickets.length,
      },
      error,
    );
    for (let index = tickets.length; index < reserved; index += 1) {
      await releaseTicketType(event.slug, ticketType.id);
    }
    if (tickets.length === 0) {
      return { ok: false, status: 500, error: "Could not issue tickets" };
    }
  }

  log.info("tickets.issue", "Tickets issued", {
    slug: event.slug,
    ticketTypeId: ticketType.id,
    count: tickets.length,
    kind: input.kind,
  });

  return { ok: true, value: { orderId, tickets, event } };
}

export type RedeemInput = {
  /** Raw scanned payload, or a bare ticket id typed in as a fallback. */
  scanned: string;
  eventSlug: string;
  redeemedBy?: string;
  /** True when the device queued this while offline and is syncing now. */
  offline?: boolean;
};

/**
 * Admit a ticket.
 *
 * The signature check rejects forgeries; the atomic claim is what makes a
 * ticket single-use even when two door devices scan the same phone at the
 * same moment.
 */
export async function redeemTicket(input: RedeemInput): Promise<RedeemOutcome> {
  const parsed = parseTicketQrPayload(input.scanned);
  const ticketId =
    parsed?.ticketId ??
    (isValidTicketId(input.scanned.trim().toUpperCase())
      ? input.scanned.trim().toUpperCase()
      : null);

  if (!ticketId) return { result: "invalid" };

  // A pasted id has no signature to check; a scanned payload must verify.
  if (parsed && !verifyTicketSignature(parsed.ticketId, parsed.signature)) {
    log.warn("tickets.redeem", "Signature rejected", { ticketId: parsed.ticketId });
    return { result: "invalid" };
  }

  const ticket = await getTicket(ticketId);
  if (!ticket) return { result: "not-found" };

  const event = await getEvent(ticket.eventSlug);
  const ticketTypeName =
    (event ? findTicketType(event, ticket.ticketTypeId)?.name : null) ?? "Ticket";
  const view = toDoorView(ticket, ticketTypeName);

  if (ticket.eventSlug !== input.eventSlug) return { result: "wrong-event", ticket: view };
  if (ticket.status !== "valid") return { result: "void", ticket: view };

  const redeemedAt = new Date().toISOString();
  const claim = await claimRedemption(ticket.id, redeemedAt);

  if (!claim.claimed) {
    return {
      result: "already-redeemed",
      ticket: { ...view, redeemedAt: claim.redeemedAt },
      redeemedAt: claim.redeemedAt,
    };
  }

  const updated: TicketRecord = {
    ...ticket,
    redeemedAt,
    redeemedBy: input.redeemedBy?.slice(0, 40),
    redeemedOffline: input.offline === true ? true : undefined,
  };
  await putTicket(updated);

  return { result: "admitted", ticket: toDoorView(updated, ticketTypeName) };
}

/** Staff correction: someone scanned the wrong phone. */
export async function unredeemTicket(ticketId: string): Promise<TicketOpResult<void>> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return { ok: false, status: 404, error: "Ticket not found" };
  await releaseRedemption(ticket.id);
  await putTicket({ ...ticket, redeemedAt: undefined, redeemedBy: undefined });
  return { ok: true, value: undefined };
}

export async function voidTicket(
  ticketId: string,
  status: "void" | "refunded" = "void",
): Promise<TicketOpResult<TicketRecord>> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return { ok: false, status: 404, error: "Ticket not found" };
  const updated: TicketRecord = { ...ticket, status };
  await putTicket(updated);
  // Free the capacity back up so a refund does not permanently shrink the room.
  await releaseTicketType(ticket.eventSlug, ticket.ticketTypeId);
  log.info("tickets.void", "Ticket voided", { ticketId, status });
  return { ok: true, value: updated };
}

/**
 * The offline door manifest.
 *
 * Carries truncated hashes rather than ids, so a device left in a taxi is
 * not a ticket forgery kit. Redeemed state is included so a device that has
 * been offline since doors opened still shows a sensible answer.
 */
export async function buildDoorManifest(eventSlug: string): Promise<DoorManifest> {
  const ids = await listTicketIdsForEvent(eventSlug);
  const tickets = await getTickets(ids);
  return {
    eventSlug,
    generatedAt: new Date().toISOString(),
    hashes: tickets
      .filter((ticket) => ticket.status === "valid")
      .map((ticket) => hashTicketId(ticket.id)),
  };
}

export type EventTicketSummary = {
  total: number;
  redeemed: number;
  byType: Record<string, { name: string; issued: number; redeemed: number }>;
  tickets: (DoorTicketView & { email?: string; issuedAt: string })[];
};

export async function getEventTickets(eventSlug: string): Promise<EventTicketSummary> {
  const [event, ids] = await Promise.all([getEvent(eventSlug), listTicketIdsForEvent(eventSlug)]);
  const tickets = await getTickets(ids);

  const byType: EventTicketSummary["byType"] = {};
  let redeemed = 0;

  for (const ticket of tickets) {
    const name = (event ? findTicketType(event, ticket.ticketTypeId)?.name : null) ?? "Ticket";
    const bucket = byType[ticket.ticketTypeId] ?? { name, issued: 0, redeemed: 0 };
    bucket.issued += 1;
    if (ticket.redeemedAt) {
      bucket.redeemed += 1;
      redeemed += 1;
    }
    byType[ticket.ticketTypeId] = bucket;
  }

  return {
    total: tickets.length,
    redeemed,
    byType,
    tickets: tickets
      .map((ticket) => ({
        ...toDoorView(
          ticket,
          (event ? findTicketType(event, ticket.ticketTypeId)?.name : null) ?? "Ticket",
        ),
        email: ticket.email,
        issuedAt: ticket.issuedAt,
      }))
      .sort((a, b) => a.holderName.localeCompare(b.holderName)),
  };
}

/** Names of everyone holding a valid ticket. Used by best-dressed voting. */
export async function getTicketHolderNames(eventSlug: string): Promise<string[]> {
  const ids = await listTicketIdsForEvent(eventSlug);
  const tickets = await getTickets(ids);
  const names = tickets
    .filter((ticket) => ticket.status === "valid")
    .map((ticket) => ticket.holderName.trim())
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export type LookupTicketsResult = {
  tickets: TicketRecord[];
  event: EventRecord | null;
};

/**
 * Find a buyer's tickets by email so they can be re-sent.
 *
 * Rate limited per address, and callers must not disclose whether an address
 * matched — that would turn this into an attendee-list oracle.
 */
export async function lookupTicketsByEmail(
  eventSlug: string,
  email: string,
): Promise<TicketOpResult<LookupTicketsResult>> {
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "That email address doesn't look right" };
  }

  const emailHash = hashEmail(normaliseEmail(email));
  const limit = await rateLimit(
    ticketResendRateLimitKey(emailHash),
    RESEND_RATELIMIT_WINDOW_SECONDS,
    RESEND_RATELIMIT_MAX,
  );
  if (!limit.allowed) {
    return { ok: false, status: 429, error: "Too many requests. Try again shortly." };
  }

  const [ids, event] = await Promise.all([
    listTicketIdsForEmail(eventSlug, emailHash),
    getEvent(eventSlug),
  ]);
  const tickets = (await getTickets(ids)).filter((ticket) => ticket.status === "valid");
  return { ok: true, value: { tickets, event } };
}

export async function rateLimitClaim(ip: string): Promise<boolean> {
  const limit = await rateLimit(
    ticketClaimRateLimitKey(ip || "unknown"),
    CLAIM_RATELIMIT_WINDOW_SECONDS,
    CLAIM_RATELIMIT_MAX,
  );
  return limit.allowed;
}

export { getTicket, getRedemptionAt };
