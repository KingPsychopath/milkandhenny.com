import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";

import { getBaseUrlForRequest } from "@/lib/shared/config";
import { log } from "@/lib/platform/logger.server";
import { recordMarketingConsent } from "@/features/communications/marketing-consent.server";
import {
  MARKETING_PRIVACY_NOTICE_VERSION,
  TICKET_MARKETING_CONSENT_VERSION,
} from "@/features/communications/marketing-consent";
import { EventsService } from "@/features/events/events-service.server";
import { managedOrderIdsForPerson } from "@/features/attendee-access/access.server";
import { requestTransferredTicketReturn } from "@/features/attendee-operations/ticket-operations.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { runEventOperationsResult } from "@/features/event-operations/runtime.server";
import { toTicketHolderEvent } from "@/features/events/types";
import { TicketsService } from "./tickets-service.server";
import { sendTicketEmail } from "./email.server";
import { buildTicketQrPayload } from "./qr.server";
import { rateLimitClaim } from "./tickets.server";
import {
  isCheckoutSessionId,
  refundTicket,
  resolveCheckoutOutcome,
  startCheckout,
} from "./checkout.server";
import { rememberTicketHolder } from "./holder-cookie.server";
import { readManagedTicketOrders, rememberManagedTicketOrder } from "./order-cookie.server";
import { resolveScannerLink } from "./scanner-links.server";
import { getTicket } from "./store.server";
import { isValidScannerToken } from "./checkpoint-types";
import {
  isValidEmail,
  isValidTicketId,
  type DoorTicketView,
  type RedeemOutcome,
  type TicketStatus,
} from "./types";

/**
 * TanStack server-function boundary for tickets.
 */

export type ClaimTicketInput = {
  eventSlug: string;
  ticketTypeId: string;
  holderName: string;
  email: string;
  quantity: number;
  marketingOptIn: boolean;
};

export type ClaimTicketResult =
  | { ok: true; ticketIds: string[]; emailQueued: boolean; emailError?: string }
  | { ok: false; status: number; error: string };

/**
 * Claim free tickets.
 *
 * Paid claims do not come through here — Phase 2 issues those from the
 * Stripe webhook, so that a ticket is never created on the strength of a
 * browser saying a payment happened.
 */
export const claimFreeTicketsFn = createServerFn({ method: "POST" })
  .validator((data: ClaimTicketInput) => data)
  .handler(async ({ data }): Promise<ClaimTicketResult> => {
    const request = getRequest();
    const origin = getBaseUrlForRequest(request);

    if (!(await rateLimitClaim(getRequestIP() || "unknown"))) {
      return { ok: false, status: 429, error: "Too many requests. Try again shortly." };
    }

    if (!isValidEmail(data.email)) {
      return { ok: false, status: 400, error: "That email address doesn't look right" };
    }

    const loaded = await runEventOperationsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        return yield* events.read(data.eventSlug);
      }),
    );
    if (!loaded.ok) return { ok: false, status: loaded.status, error: loaded.error };

    const event = loaded.value;
    if (!event) return { ok: false, status: 404, error: "Event not found" };

    const ticketType = event.ticketTypes.find((type) => type.id === data.ticketTypeId);
    if (!ticketType) return { ok: false, status: 404, error: "Ticket type not found" };
    if (ticketType.priceMinor > 0) {
      return { ok: false, status: 400, error: "This ticket has to be paid for" };
    }

    const issued = await runEventOperationsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.issue({
          eventSlug: data.eventSlug,
          ticketTypeId: data.ticketTypeId,
          holderName: data.holderName,
          email: data.email,
          quantity: data.quantity,
          kind: "free",
          enforceIdentityAcquisition: true,
        });
      }),
    );
    if (!issued.ok) return { ok: false, status: issued.status, error: issued.error };
    if (!issued.value.ok)
      return { ok: false, status: issued.value.status, error: issued.value.error };

    const { tickets } = issued.value.value;

    if (data.marketingOptIn === true) {
      try {
        await recordMarketingConsent({
          email: data.email,
          displayName: data.holderName,
          source: "ticket_purchase",
          sourceRef: tickets[0]?.orderId ?? null,
          consentVersion: TICKET_MARKETING_CONSENT_VERSION,
          privacyVersion: MARKETING_PRIVACY_NOTICE_VERSION,
        });
      } catch (error) {
        // The ticket already exists. Keep delivery usable if the optional
        // contact write is temporarily unavailable; the admin list can repair
        // the preference from the recorded purchase.
        log.error(
          "marketing.consent",
          "Free ticket consent could not be saved",
          {
            eventSlug: data.eventSlug,
          },
          error,
        );
      }
    }

    // Delivery failure must not fail issuance — the tickets exist and the
    // resend flow can recover them.
    const delivery = await sendTicketEmail({
      event,
      tickets,
      origin,
      idempotencyKey: `tickets:issued:${tickets[0].orderId}`,
      kind: "ticket-issued",
      source: "self-service",
    });

    rememberTicketHolder(event.slug);

    return {
      ok: true,
      ticketIds: tickets.map((ticket) => ticket.id),
      emailQueued: delivery.queued,
      emailError: delivery.error,
    };
  });

export type ResendResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Resend an order's tickets.
 *
 * Always reports success when the address is well-formed, whether or not it
 * matched anything. Reporting "no tickets for that address" would turn this
 * into a way to test who is attending.
 */
export const resendTicketsFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; email: string }) => data)
  .handler(async ({ data }): Promise<ResendResult> => {
    const request = getRequest();
    const origin = getBaseUrlForRequest(request);

    if (!isValidEmail(data.email)) {
      return { ok: false, status: 400, error: "That email address doesn't look right" };
    }

    const found = await runEventOperationsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.lookupByEmail(data.eventSlug, data.email);
      }),
    );
    if (!found.ok) return { ok: false, status: found.status, error: found.error };
    if (!found.value.ok) {
      return { ok: false, status: found.value.status, error: found.value.error };
    }

    const { tickets, event } = found.value.value;
    if (event && tickets.length > 0) {
      const resendWindow = Math.floor(Date.now() / 60_000);
      const orders = [...new Set(tickets.map((ticket) => ticket.orderId))].sort().join(":");
      await sendTicketEmail({
        event,
        tickets,
        origin,
        idempotencyKey: `tickets:resend:${orders}:${resendWindow}`,
        kind: "ticket-resend",
        source: "self-service",
      });
    }

    return { ok: true };
  });

export type DoorRedeemResult = { authorised: false } | { authorised: true; outcome: RedeemOutcome };

/**
 * A door action is allowed by a live scanner link for that event's door.
 * Returns who is scanning, for the audit trail.
 */
async function authoriseDoor(
  eventSlug: string,
  scannerToken: string | undefined,
): Promise<{ ok: true; redeemedBy?: string } | { ok: false }> {
  if (scannerToken && isValidScannerToken(scannerToken)) {
    const link = await resolveScannerLink(scannerToken);
    if (link && link.eventSlug === eventSlug && link.checkpointId === null) {
      return { ok: true, redeemedBy: link.label };
    }
  }
  return { ok: false };
}

export const redeemTicketFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      scanned: string;
      eventSlug: string;
      redeemedBy?: string;
      offline?: boolean;
      scannerToken?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<DoorRedeemResult> => {
    const auth = await authoriseDoor(data.eventSlug, data.scannerToken);
    if (!auth.ok) return { authorised: false };

    const result = await runEventOperationsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.redeem({
          scanned: data.scanned,
          eventSlug: data.eventSlug,
          redeemedBy: auth.redeemedBy ?? data.redeemedBy,
          offline: data.offline,
        });
      }),
    );

    if (!result.ok) return { authorised: true, outcome: { result: "invalid" } };
    return { authorised: true, outcome: result.value };
  });

export type DoorDataResult =
  | { authorised: false }
  | {
      authorised: true;
      eventSlug: string;
      eventTitle: string;
      manifestHashes: string[];
      generatedAt: string;
      summary: { total: number; redeemed: number };
      tickets: (DoorTicketView & { issuedAt: string })[];
    };

/** Everything a door device needs to keep working when the wifi drops. */
export const getDoorDataFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; scannerToken?: string }) => data)
  .handler(async ({ data }): Promise<DoorDataResult> => {
    const auth = await authoriseDoor(data.eventSlug, data.scannerToken);
    if (!auth.ok) return { authorised: false };

    const result = await runEventOperationsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        const tickets = yield* TicketsService;
        const event = yield* events.read(data.eventSlug);
        const manifest = yield* tickets.manifest(data.eventSlug);
        const summary = yield* tickets.forEvent(data.eventSlug);
        return { event, manifest, summary };
      }),
    );

    if (!result.ok || !result.value.event) return { authorised: false };

    const { event, manifest, summary } = result.value;
    return {
      authorised: true,
      eventSlug: event.slug,
      eventTitle: event.title,
      manifestHashes: manifest.hashes,
      generatedAt: manifest.generatedAt,
      summary: { total: summary.valid, redeemed: summary.redeemed },
      tickets: summary.tickets.map(({ email: _email, ...rest }) => rest),
    };
  });

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

/**
 * Begin a paid purchase.
 *
 * Returns a Stripe-hosted Checkout URL. No ticket exists yet — the webhook
 * creates it once the payment actually succeeds.
 */
export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      ticketTypeId: string;
      holderName: string;
      email: string;
      quantity: number;
      acceptedTerms: boolean;
      marketingOptIn: boolean;
      checkoutRequestId?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<StartCheckoutResult> => {
    const request = getRequest();

    if (!(await rateLimitClaim(getRequestIP() || "unknown"))) {
      return { ok: false, status: 429, error: "Too many requests. Try again shortly." };
    }

    const result = await startCheckout({ ...data, origin: getBaseUrlForRequest(request) });
    if (!result.ok) return { ok: false, status: result.status, error: result.error };
    return { ok: true, url: result.value.url };
  });

export type CheckoutOutcomeTicket = {
  id: string;
  holderName: string;
  qrPayload: string;
  /** This link is permanent, so it must not still show a live QR after a refund. */
  status: TicketStatus;
  redeemedAt?: string;
};

export type CheckoutOutcomeResult =
  | { state: "unknown" }
  | { state: "pending" }
  | { state: "problem"; message: string }
  | {
      state: "complete";
      event: ReturnType<typeof toTicketHolderEvent>;
      tickets: CheckoutOutcomeTicket[];
      /** The purchaser ticket, which is the link that manages the whole order. */
      managerTicketId: string;
      /** Where the tickets were emailed, so a typo is visible before the night. */
      email: string;
      amountMinor: number;
      currency: string;
    };

/**
 * The confirmation page's whole data source.
 *
 * The Stripe session id in the URL is the credential, exactly as a ticket id
 * is on the ticket page: it is known only to the person Stripe just redirected
 * and to us. Everything it unlocks — the QRs, the address — that person is
 * already entitled to.
 */
export const getCheckoutOutcomeFn = createServerFn({ method: "GET" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }): Promise<CheckoutOutcomeResult> => {
    if (!isCheckoutSessionId(data.sessionId)) return { state: "unknown" };

    const request = getRequest();
    const outcome = await resolveCheckoutOutcome(data.sessionId, getBaseUrlForRequest(request));
    if (outcome.state !== "complete") return outcome;

    const { event, tickets, orderId } = outcome;
    const primary = tickets.find((ticket) => !ticket.parentTicketId) ?? tickets[0];

    // Paying is what earns the address, and this browser is the purchaser's,
    // so it also earns the rest of the order from any one of its ticket links.
    rememberTicketHolder(event.slug);
    rememberManagedTicketOrder(orderId);

    return {
      state: "complete",
      event: toTicketHolderEvent(event),
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        holderName: ticket.holderName,
        qrPayload: buildTicketQrPayload(ticket.accessReference ?? ticket.id),
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
      })),
      managerTicketId: primary.id,
      email: outcome.email,
      amountMinor: outcome.amountMinor,
      currency: outcome.currency,
    };
  });

export type RefundResult =
  | {
      ok: true;
      state: "succeeded" | "pending" | "consent-pending";
      refunded: number;
      emailQueued: boolean;
    }
  | { ok: false; error: string };

/**
 * Self-serve refund from the ticket page.
 *
 * Each child ticket owns its allocation. The page grants order authority;
 * this workflow invalidates only the selected ticket.
 */
export const refundOwnTicketFn = createServerFn({ method: "POST" })
  .validator((data: { ticketId: string }) => data)
  .handler(async ({ data }): Promise<RefundResult> => {
    if (!isValidTicketId(data.ticketId)) {
      return { ok: false, error: "That ticket reference doesn't look right" };
    }
    const ticket = await getTicket(data.ticketId);
    if (!ticket) return { ok: false, error: "Ticket not found" };
    const browserOrders = readManagedTicketOrders();
    let personOrders: string[] = [];
    let attendeePersonId: string | undefined;
    try {
      const session = await getAttendeeSession();
      if (session?.personId) {
        attendeePersonId = session.personId;
        personOrders = await managedOrderIdsForPerson(session.personId);
      }
    } catch {
      // Signed purchaser authority remains sufficient when attendee access is unavailable.
    }
    const managesOrder = [...browserOrders, ...personOrders].includes(ticket.orderId);
    if (!managesOrder && !attendeePersonId)
      return { ok: false, error: "Verify your email before requesting this ticket return" };
    if (!managesOrder) {
      const requested = await requestTransferredTicketReturn({
        ticketId: data.ticketId,
        requesterPersonId: attendeePersonId!,
        origin: getBaseUrlForRequest(getRequest()),
      });
      return requested.ok
        ? {
            ok: true,
            state: "consent-pending",
            refunded: 0,
            emailQueued: requested.value.emailQueued,
          }
        : { ok: false, error: requested.error };
    }
    const result = await refundTicket({
      ticketId: data.ticketId,
      reason: "self-serve",
      actorId: attendeePersonId,
    });
    if (!result.ok && result.error.includes("current holder's consent") && attendeePersonId) {
      const requested = await requestTransferredTicketReturn({
        ticketId: data.ticketId,
        requesterPersonId: attendeePersonId,
        origin: getBaseUrlForRequest(getRequest()),
      });
      return requested.ok
        ? {
            ok: true,
            state: "consent-pending",
            refunded: 0,
            emailQueued: requested.value.emailQueued,
          }
        : { ok: false, error: requested.error };
    }
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      state: result.value.state,
      refunded: result.value.refunded,
      emailQueued: result.value.emailQueued,
    };
  });
