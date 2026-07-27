import { Context, Layer } from "effect";

import { eventsOperation } from "@/features/events/events-operation.server";
import * as engine from "./tickets.server";
import type { IssueTicketsInput, RedeemInput } from "./tickets.server";

/**
 * Tickets service.
 *
 * Redemption gets a tighter timeout than everything else: at a door, a scan
 * that fails fast can be retried in a second, while a scan that hangs holds
 * up the queue and invites staff to wave people through unchecked.
 */
export class TicketsService extends Context.Service<
  TicketsService,
  {
    readonly issue: typeof issue;
    readonly redeem: typeof redeem;
    readonly unredeem: typeof unredeem;
    readonly void: typeof voidTicket;
    readonly manifest: typeof manifest;
    readonly forEvent: typeof forEvent;
    readonly holderNames: typeof holderNames;
    readonly lookupByEmail: typeof lookupByEmail;
    readonly read: typeof read;
  }
>()("TicketsService") {
  static readonly layer = Layer.succeed(this, {
    issue,
    redeem,
    unredeem,
    void: voidTicket,
    manifest,
    forEvent,
    holderNames,
    lookupByEmail,
    read,
  });
}

function issue(input: IssueTicketsInput) {
  return eventsOperation({ domain: "tickets", operation: "issue", timeoutMs: 12_000 }, () =>
    engine.issueTickets(input),
  );
}

function redeem(input: RedeemInput) {
  return eventsOperation({ domain: "tickets", operation: "redeem", timeoutMs: 4_000 }, () =>
    engine.redeemTicket(input),
  );
}

function unredeem(ticketId: string) {
  return eventsOperation({ domain: "tickets", operation: "unredeem", timeoutMs: 4_000 }, () =>
    engine.unredeemTicket(ticketId),
  );
}

function voidTicket(ticketId: string, status?: "void" | "refunded") {
  return eventsOperation({ domain: "tickets", operation: "void" }, () =>
    engine.voidTicket(ticketId, status),
  );
}

function manifest(eventSlug: string) {
  return eventsOperation({ domain: "tickets", operation: "manifest", timeoutMs: 15_000 }, () =>
    engine.buildDoorManifest(eventSlug),
  );
}

function forEvent(eventSlug: string) {
  return eventsOperation({ domain: "tickets", operation: "for_event", timeoutMs: 15_000 }, () =>
    engine.getEventTickets(eventSlug),
  );
}

function holderNames(eventSlug: string) {
  return eventsOperation({ domain: "tickets", operation: "holder_names", timeoutMs: 15_000 }, () =>
    engine.getTicketHolderNames(eventSlug),
  );
}

function lookupByEmail(eventSlug: string, email: string) {
  return eventsOperation({ domain: "tickets", operation: "lookup_by_email" }, () =>
    engine.lookupTicketsByEmail(eventSlug, email),
  );
}

function read(ticketId: string) {
  return eventsOperation({ domain: "tickets", operation: "read" }, () =>
    engine.getTicket(ticketId),
  );
}
