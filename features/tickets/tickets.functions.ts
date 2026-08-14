import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";

import { getBaseUrlForRequest } from "@/lib/shared/config";
import { EventsService } from "@/features/events/events-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";
import { toTicketHolderEvent, type EventRecord } from "@/features/events/types";
import { TicketsService } from "./tickets-service.server";
import { sendTicketEmail } from "./email.server";
import { buildTicketQrPayload } from "./qr.server";
import { rateLimitClaim } from "./tickets.server";
import { refundOrder, startCheckout } from "./checkout.server";
import { rememberTicketHolder } from "./holder-cookie.server";
import { resolveScannerLink } from "./scanner-links.server";
import { isValidScannerToken } from "./checkpoint-types";
import {
  isValidEmail,
  isValidTicketId,
  type DoorTicketView,
  type OrderTicketView,
  type TicketPageTicket,
  type RedeemOutcome,
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
};

export type ClaimTicketResult =
  | { ok: true; ticketIds: string[]; emailed: boolean; emailError?: string }
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

    const loaded = await runEventsResult(
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

    const issued = await runEventsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.issue({
          eventSlug: data.eventSlug,
          ticketTypeId: data.ticketTypeId,
          holderName: data.holderName,
          email: data.email,
          quantity: data.quantity,
          kind: "free",
        });
      }),
    );
    if (!issued.ok) return { ok: false, status: issued.status, error: issued.error };
    if (!issued.value.ok)
      return { ok: false, status: issued.value.status, error: issued.value.error };

    const { tickets } = issued.value.value;

    // Delivery failure must not fail issuance — the tickets exist and the
    // resend flow can recover them.
    const delivery = await sendTicketEmail({ event, tickets, origin });

    rememberTicketHolder(event.slug);

    return {
      ok: true,
      ticketIds: tickets.map((ticket) => ticket.id),
      emailed: delivery.sent,
      emailError: delivery.error,
    };
  });

export type TicketPageResult =
  | { found: false }
  | {
      found: true;
      ticket: TicketPageTicket;
      qrPayload: string;
      event: ReturnType<typeof toTicketHolderEvent>;
      /** Tickets bought together, so one delivery link opens the whole order. */
      orderTickets: OrderTicketView[];
    };

export const getTicketPageFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<TicketPageResult> => {
    const loaded = await runEventsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.read(data.id);
      }),
    );
    if (!loaded.ok || !loaded.value) return { found: false };

    const ticket = loaded.value;
    const detailResult = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        const tickets = yield* TicketsService;
        const event = yield* events.read(ticket.eventSlug);
        const orderTickets = yield* tickets.order(ticket.orderId);
        return { event, orderTickets };
      }),
    );
    if (!detailResult.ok || !detailResult.value.event) return { found: false };

    const event: EventRecord = detailResult.value.event;

    // Holding a ticket is what earns the address.
    rememberTicketHolder(event.slug);

    return {
      found: true,
      ticket: {
        id: ticket.id,
        holderName: ticket.holderName,
        kind: ticket.kind,
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
        amountPaidMinor: ticket.amountPaidMinor,
        currency: ticket.currency,
      },
      qrPayload: buildTicketQrPayload(ticket.id),
      event: toTicketHolderEvent(event),
      orderTickets: detailResult.value.orderTickets.map(
        ({ id, holderName, status, redeemedAt, amountPaidMinor, currency }) => ({
          id,
          holderName,
          status,
          redeemedAt,
          amountPaidMinor,
          currency,
        }),
      ),
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

    const found = await runEventsResult(
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
      await sendTicketEmail({ event, tickets, origin });
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

    const result = await runEventsResult(
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

    const result = await runEventsResult(
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

export type RefundResult =
  | {
      ok: true;
      state: "succeeded" | "pending";
      refunded: number;
      emailed: boolean;
    }
  | { ok: false; error: string };

/**
 * Self-serve refund from the ticket page.
 *
 * The ticket id in the URL is the bearer credential — the same thing that
 * gets someone through the door. Refusing after check-in is enforced in
 * `refundOrder`, not here.
 */
export const refundOwnTicketFn = createServerFn({ method: "POST" })
  .validator((data: { ticketId: string }) => data)
  .handler(async ({ data }): Promise<RefundResult> => {
    if (!isValidTicketId(data.ticketId)) {
      return { ok: false, error: "That ticket reference doesn't look right" };
    }
    const result = await refundOrder({ ticketId: data.ticketId, reason: "self-serve" });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      state: result.value.state,
      refunded: result.value.refunded,
      emailed: result.value.emailed,
    };
  });
