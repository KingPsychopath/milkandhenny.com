import { log } from "@/lib/platform/logger.server";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";
import { identityMayAcquire } from "@/features/attendee-operations/identity-policy.server";
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
  getSoldCounts,
  getTicket,
  insertTicketsWithCapacity,
  listActiveTicketExchangesForEvent,
  listTicketsForEmail,
  listTicketsForEvent,
  listTicketsForOrder,
  listValidTicketIds,
  markTicketStatus,
  releaseRedemption,
  type NewTicket,
} from "./store.server";
import {
  generateOrderId,
  generateTicketId,
  hashEmail,
  hashTicketId,
  isTicketSigningConfigured,
  verifyTicketSignature,
} from "./qr.server";
import { getTicketCapacitySnapshot } from "./capacity.server";
import {
  isValidTicketId,
  MAX_TICKETS_PER_ORDER,
  parseTicketQrPayload,
  type DoorManifest,
  type DoorTicketView,
  type RedeemOutcome,
  type TicketKind,
  type TicketRecord,
} from "./types";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import {
  markParticipantCheckedIn,
  participantForTicket,
} from "@/features/event-scoring/store.server";
import { publishTicketEvent } from "./ticket-events.server";

/**
 * Ticket workflows.
 *
 * Plain async engine functions. Capacity and single-admission are enforced in
 * the store by the database; this layer owns the product rules around them —
 * sales windows, per-person limits, who may be comped.
 */

export type TicketOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

/** Public ticket actions share the production fail-closed rate limiter. */
async function rateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const decision = await reserveRateLimit({
    name: "tickets-public",
    identity: key,
    limit: max,
    windowSeconds,
  });
  return decision.allowed;
}

function findTicketType(event: EventRecord, ticketTypeId: string): TicketType | null {
  return event.ticketTypes.find((type) => type.id === ticketTypeId) ?? null;
}

function toDoorView(ticket: TicketRecord, ticketTypeName: string): DoorTicketView {
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    holderName: ticket.holderName,
    ticketTypeName,
    kind: ticket.kind,
    status: ticket.status,
    redeemedAt: ticket.redeemedAt,
    isPlusOne: Boolean(ticket.parentTicketId),
  };
}

export async function getTicketOrder(orderId: string): Promise<TicketRecord[]> {
  return listTicketsForOrder(orderId);
}

export type IssueTicketsInput = {
  eventSlug: string;
  ticketTypeId: string;
  holderName: string;
  email?: string;
  quantity: number;
  kind: TicketKind;
  paymentRef?: string;
  checkoutRef?: string;
  capacityHoldReference?: string;
  amountPaidMinor?: number;
  /** Exact per-ticket allocations when an order total does not divide evenly. */
  amountAllocationsMinor?: readonly number[];
  currency?: string;
  notes?: string;
  /** Staff may issue comps when public sales are closed. */
  bypassSalesWindow?: boolean;
  /** Explicit admission beyond capacity; callers must make this visible to staff. */
  bypassCapacity?: boolean;
  /** Public acquisition checks this; fulfilment of an already-paid checkout does not. */
  enforceIdentityAcquisition?: boolean;
};

export type IssuedTickets = {
  orderId: string;
  tickets: TicketRecord[];
  event: EventRecord;
};

export async function issueTickets(
  input: IssueTicketsInput,
): Promise<TicketOpResult<IssuedTickets>> {
  if (!isTicketSigningConfigured()) {
    return { ok: false, status: 503, error: "Ticketing is not configured" };
  }

  const holderName = input.holderName?.trim();
  if (!holderName) return { ok: false, status: 400, error: "A name is required" };
  if (holderName.length > 120) return { ok: false, status: 400, error: "That name is too long" };

  const quantity = input.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_ORDER) {
    return { ok: false, status: 400, error: `Choose between 1 and ${MAX_TICKETS_PER_ORDER}` };
  }

  if (input.email !== undefined && !isValidEmail(input.email)) {
    return { ok: false, status: 400, error: "That email address doesn't look right" };
  }
  if (
    input.enforceIdentityAcquisition === true &&
    input.email &&
    !(await identityMayAcquire(input.email))
  ) {
    return {
      ok: false,
      status: 403,
      error:
        "This email cannot claim new tickets. Existing tickets and orders are still available in your account.",
    };
  }

  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const ticketType = findTicketType(event, input.ticketTypeId);
  if (!ticketType) return { ok: false, status: 404, error: "Ticket type not found" };

  if (!input.bypassSalesWindow) {
    if (ticketType.hidden) {
      return { ok: false, status: 404, error: "Ticket type not found" };
    }
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
  }
  if (!input.bypassCapacity && quantity > ticketType.perPersonLimit) {
    return {
      ok: false,
      status: 409,
      error: `Limit of ${ticketType.perPersonLimit} per person for ${ticketType.name}`,
    };
  }

  const email = input.email ? normaliseEmail(input.email) : undefined;
  const orderId = generateOrderId();
  if (
    input.amountAllocationsMinor &&
    (input.amountAllocationsMinor.length !== quantity ||
      input.amountAllocationsMinor.some((amount) => !Number.isInteger(amount) || amount < 0))
  ) {
    return { ok: false, status: 400, error: "Ticket payment allocations are invalid" };
  }

  // Ids are generated up front so plus-ones can point at the first ticket.
  const ids = Array.from({ length: quantity }, () => generateTicketId());
  const newTickets: NewTicket[] = ids.map((id, index) => ({
    id,
    holderName: index === 0 ? holderName : `${holderName} +${index}`,
    parentTicketId: index === 0 ? undefined : ids[0],
    amountPaidMinor: input.amountAllocationsMinor?.[index],
  }));

  const outcome = await insertTicketsWithCapacity(
    {
      eventSlug: event.slug,
      ticketTypeId: ticketType.id,
      kind: input.kind,
      orderId,
      email,
      emailHash: email ? hashEmail(email) : undefined,
      paymentRef: input.paymentRef,
      checkoutRef: input.checkoutRef,
      capacityHoldReference: input.capacityHoldReference,
      amountPaidMinor: input.amountPaidMinor,
      currency: input.currency ?? ticketType.currency,
      notes: input.notes,
      bypassCapacity: input.bypassCapacity === true,
      enforceSalesWindow: input.bypassSalesWindow !== true,
    },
    newTickets,
  );

  if (!outcome.ok) {
    if (outcome.reason === "unknown-type") {
      return { ok: false, status: 404, error: "Ticket type not found" };
    }
    if (outcome.reason === "per-person-limit") {
      return {
        ok: false,
        status: 409,
        error: `Limit of ${outcome.limit} per person for ${ticketType.name}`,
      };
    }
    if (outcome.reason === "not-on-sale") {
      return { ok: false, status: 409, error: "These tickets aren't on sale right now" };
    }
    return {
      ok: false,
      status: 409,
      error:
        outcome.remaining === 0
          ? `${ticketType.name} is sold out`
          : `Only ${outcome.remaining} ${ticketType.name} left`,
    };
  }

  log.info("tickets.issue", "Tickets issued", {
    slug: event.slug,
    ticketTypeId: ticketType.id,
    count: outcome.tickets.length,
    kind: input.kind,
  });

  return { ok: true, value: { orderId, tickets: outcome.tickets, event } };
}

export type RedeemInput = {
  /** Raw scanned payload, or a bare ticket id typed in as a fallback. */
  scanned: string;
  eventSlug: string;
  redeemedBy?: string;
  offline?: boolean;
};

export async function redeemTicket(input: RedeemInput): Promise<RedeemOutcome> {
  const parsed = parseTicketQrPayload(input.scanned);
  const typed = input.scanned.trim().toUpperCase();
  const ticketId = parsed?.ticketId ?? (isValidTicketId(typed) ? typed : null);

  if (!ticketId) return { result: "invalid" };

  // A pasted id has no signature to check; a scanned payload must verify.
  if (parsed && !verifyTicketSignature(parsed.ticketId, parsed.signature)) {
    log.warn("tickets.redeem", "Signature rejected", { ticketId: parsed.ticketId });
    return { result: "invalid" };
  }

  const existing = await getTicket(ticketId);
  if (!existing) return { result: "not-found" };

  // A transfer rotates the bearer reference. Internal ids remain resolvable
  // for administration, but an old QR must lose door authority immediately.
  if (existing.accessReference && ticketId !== existing.accessReference) {
    return { result: "invalid" };
  }

  const event = await getEvent(existing.eventSlug);
  const ticketTypeName =
    (event ? findTicketType(event, existing.ticketTypeId)?.name : null) ?? "Ticket";

  if (existing.eventSlug !== input.eventSlug) {
    return { result: "wrong-event", ticket: toDoorView(existing, ticketTypeName) };
  }
  if (existing.status !== "valid") {
    return { result: "void", ticket: toDoorView(existing, ticketTypeName) };
  }

  const claim = await claimRedemption(existing.id, input.redeemedBy, input.offline === true);

  if (claim.claimed) {
    const participant = await participantForTicket(claim.ticket.id);
    if (participant) await markParticipantCheckedIn(participant.id);
    await publishTicketEvent({
      eventSlug: claim.ticket.eventSlug,
      ticketId: claim.ticket.id,
      kind: "checked-in",
      occurredAt: claim.ticket.redeemedAt ?? new Date().toISOString(),
    }).catch((error: unknown) =>
      log.warn("tickets.realtime", "Admission succeeded but its live wake-up failed", {
        ticketId: claim.ticket.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { result: "admitted", ticket: toDoorView(claim.ticket, ticketTypeName) };
  }

  if (!claim.ticket) return { result: "not-found" };
  if (claim.ticket.status !== "valid") {
    return { result: "void", ticket: toDoorView(claim.ticket, ticketTypeName) };
  }
  if (!claim.ticket.redeemedAt) return { result: "invalid" };

  return {
    result: "already-redeemed",
    ticket: toDoorView(claim.ticket, ticketTypeName),
    redeemedAt: claim.ticket.redeemedAt ?? new Date().toISOString(),
  };
}

export async function unredeemTicket(ticketId: string): Promise<TicketOpResult<void>> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return { ok: false, status: 404, error: "Ticket not found" };
  await releaseRedemption(ticket.id);
  await publishTicketEvent({
    eventSlug: ticket.eventSlug,
    ticketId: ticket.id,
    kind: "unchecked-in",
    occurredAt: new Date().toISOString(),
  }).catch(() => undefined);
  return { ok: true, value: undefined };
}

export async function voidTicket(
  ticketId: string,
  status: "void" | "refunded" = "void",
  refundRef?: string,
): Promise<TicketOpResult<TicketRecord>> {
  const updated = await markTicketStatus(ticketId, status, refundRef);
  if (!updated) return { ok: false, status: 404, error: "Ticket not found" };
  return { ok: true, value: updated };
}

export async function buildDoorManifest(eventSlug: string): Promise<DoorManifest> {
  const ids = await listValidTicketIds(eventSlug);
  return {
    eventSlug,
    generatedAt: new Date().toISOString(),
    hashes: ids.map(hashTicketId),
  };
}

export type EventTicketSummary = {
  /** All tickets ever issued, including refunded and void tickets. */
  total: number;
  /** Tickets that can still enter; this is the current sold count. */
  valid: number;
  redeemed: number;
  refunded: number;
  void: number;
  grossMinor: number;
  netMinor: number;
  currency?: string;
  reserved: number;
  byType: Record<
    string,
    {
      name: string;
      issued: number;
      redeemed: number;
      valid: number;
      reserved: number;
      remaining: number;
    }
  >;
  tickets: (DoorTicketView & {
    /** Internal admin identifier is `id`; this is the current scanner authority when rotated. */
    publicId?: string;
    ticketTypeId: string;
    email?: string;
    issuedAt: string;
    refundedAt?: string;
    amountPaidMinor?: number;
    currency?: string;
    activeExchange?: {
      status: "processing" | "awaiting_payment" | "refund_pending";
      toTicketTypeId: string;
      toTicketTypeName: string;
      errorMessage?: string;
    };
  })[];
};

export async function getEventTickets(eventSlug: string): Promise<EventTicketSummary> {
  const [event, tickets, capacity, exchanges] = await Promise.all([
    getEvent(eventSlug),
    listTicketsForEvent(eventSlug),
    getTicketCapacitySnapshot(eventSlug),
    listActiveTicketExchangesForEvent(eventSlug),
  ]);
  const activeExchangeByTicket = new Map(
    exchanges.map((exchange) => [exchange.ticketId, exchange]),
  );

  const byType: EventTicketSummary["byType"] = {};
  let redeemed = 0;
  let valid = 0;
  let refunded = 0;
  let voidCount = 0;
  let grossMinor = 0;
  let netMinor = 0;
  const currency = tickets.find((ticket) => ticket.currency)?.currency;

  for (const ticket of tickets) {
    const name = (event ? findTicketType(event, ticket.ticketTypeId)?.name : null) ?? "Ticket";
    const bucket = byType[ticket.ticketTypeId] ?? {
      name,
      issued: 0,
      redeemed: 0,
      valid: 0,
      reserved: 0,
      remaining: 0,
    };
    bucket.issued += 1;
    if (ticket.status === "valid") {
      bucket.valid += 1;
      valid += 1;
      netMinor += ticket.amountPaidMinor ?? 0;
      if (ticket.redeemedAt) {
        bucket.redeemed += 1;
        redeemed += 1;
      }
    } else if (ticket.status === "refunded") {
      refunded += 1;
    } else {
      voidCount += 1;
    }
    grossMinor += ticket.amountPaidMinor ?? 0;
    byType[ticket.ticketTypeId] = bucket;
  }

  for (const type of event?.ticketTypes ?? []) {
    const bucket = byType[type.id] ?? {
      name: type.name,
      issued: 0,
      redeemed: 0,
      valid: 0,
      reserved: 0,
      remaining: 0,
    };
    bucket.valid = capacity.sold[type.id] ?? 0;
    bucket.reserved =
      (capacity.checkoutReserved[type.id] ?? 0) + (capacity.exchangeReserved[type.id] ?? 0);
    bucket.remaining = Math.max(0, type.quantity - bucket.valid - bucket.reserved);
    byType[type.id] = bucket;
  }

  const reserved = Object.values(capacity.checkoutReserved).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    total: tickets.length,
    valid,
    redeemed,
    refunded,
    void: voidCount,
    grossMinor,
    netMinor,
    currency,
    reserved,
    byType,
    tickets: tickets.map((ticket) => ({
      ...toDoorView(
        ticket,
        (event ? findTicketType(event, ticket.ticketTypeId)?.name : null) ?? "Ticket",
      ),
      id: ticket.id,
      publicId: ticket.accessReference,
      ticketTypeId: ticket.ticketTypeId,
      email: ticket.email,
      issuedAt: ticket.issuedAt,
      refundedAt: ticket.refundedAt,
      amountPaidMinor: ticket.amountPaidMinor,
      currency: ticket.currency,
      activeExchange: activeExchangeByTicket.get(ticket.id),
    })),
  };
}

/** Names of everyone holding a valid ticket. Used by best-dressed voting. */
export async function getTicketHolderNames(eventSlug: string): Promise<string[]> {
  const tickets = await listTicketsForEvent(eventSlug);
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
 * Callers must not disclose whether an address matched — that would turn
 * this into an attendee-list oracle.
 */
export async function lookupTicketsByEmail(
  eventSlug: string,
  email: string,
): Promise<TicketOpResult<LookupTicketsResult>> {
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "That email address doesn't look right" };
  }

  const emailHash = hashEmail(normaliseEmail(email));
  const allowed = await rateLimit(
    ticketResendRateLimitKey(emailHash),
    RESEND_RATELIMIT_WINDOW_SECONDS,
    RESEND_RATELIMIT_MAX,
  );
  if (!allowed) {
    return { ok: false, status: 429, error: "Too many requests. Try again shortly." };
  }

  const [tickets, event] = await Promise.all([
    listTicketsForEmail(eventSlug, emailHash),
    getEvent(eventSlug),
  ]);
  return { ok: true, value: { tickets, event } };
}

export async function rateLimitClaim(ip: string): Promise<boolean> {
  return rateLimit(
    ticketClaimRateLimitKey(ip || "unknown"),
    CLAIM_RATELIMIT_WINDOW_SECONDS,
    CLAIM_RATELIMIT_MAX,
  );
}

export { getTicket, getSoldCounts };
