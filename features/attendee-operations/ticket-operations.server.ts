import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { establishEmailAuthenticatedSession } from "@/features/attendee-access/email-authentication.server";
import { generateTicketId } from "@/features/tickets/qr.server";
import { refundTicket } from "@/features/tickets/checkout.server";
import { isValidEmail, normaliseEmail } from "@/features/tickets/types";
import { sendEmail } from "@/lib/platform/email.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import {
  actionEmailHash,
  consumeActionLink,
  issueActionLink,
  inspectActionLink,
  maskActionEmail,
  revokeActionLink,
} from "./action-links.server";
import { createOrResolveInvitedPerson } from "./invited-person.server";
import { emitDomainEvent } from "./notifications.server";
import {
  capabilityMap,
  effectiveCapability,
  DEFAULT_GLOBAL_AVAILABILITY,
  DEFAULT_NEW_EVENT_CAPABILITIES,
} from "./types";

export type TicketOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

class TicketOperationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TicketOperationError";
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function operationOrigin(origin?: string): string | null {
  return (
    origin?.trim() || process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim() || null
  );
}

function actionEmail(input: {
  origin: string;
  recipient: string;
  eventTitle: string;
  ticketLabel: string;
  action: "assignment" | "transfer" | "return";
  actionUrl: string;
  initiatedBy?: string;
  expiresAt: Date;
}) {
  const labels = {
    assignment: {
      subject: `A ticket is waiting for you — ${input.eventTitle}`,
      title: "Use your ticket",
      verb: "A ticket has been assigned to you.",
      button: "use this ticket",
    },
    transfer: {
      subject: `Ticket transfer — ${input.eventTitle}`,
      title: "Accept this ticket",
      verb: "Someone has offered to transfer a ticket to you.",
      button: "review transfer",
    },
    return: {
      subject: `Confirm a ticket return — ${input.eventTitle}`,
      title: "Confirm this return",
      verb: "The other person on this ticket has requested a return and refund.",
      button: "review return",
    },
  } as const;
  const copy = labels[input.action];
  const expiry = input.expiresAt.toISOString();
  const initiator = input.initiatedBy ? ` Initiated by ${input.initiatedBy}.` : "";
  return {
    channel: "access" as const,
    to: input.recipient,
    subject: copy.subject,
    text: `${copy.verb}${initiator}\n\nEvent: ${input.eventTitle}\nTicket: ${input.ticketLabel}\nExpires: ${expiry}\n\n${copy.button}: ${input.actionUrl}\n\nIf this was not expected, do not use the link and contact hello@milkandhenny.com.`,
    html: renderBrandedEmail({
      origin: input.origin,
      label: "ticket access",
      title: copy.title,
      meta: `${input.eventTitle} · ${input.ticketLabel}`,
      contentHtml: `<p>${escapeEmailHtml(copy.verb + initiator)}</p><p>This one-time link expires ${escapeEmailHtml(expiry)}.</p>`,
      action: { label: copy.button, url: input.actionUrl },
      note: "If this was not expected, do not use the link and contact us. Private payments or resale are not supported.",
    }),
  };
}

async function sendOperationLifecycle(input: {
  kind: "assignment" | "transfer";
  operationId: string;
  state: "accepted" | "declined" | "cancelled" | "expired" | "invalidated";
}) {
  const table = input.kind === "assignment" ? "ticket_assignments" : "ticket_transfers";
  const senderEmail =
    input.kind === "transfer"
      ? `coalesce((
           select prior.recipient_email from ticket_transfers prior
            where prior.ticket_id = operation.ticket_id
              and prior.status = 'accepted'
              and prior.accepted_by_person_id = operation.sender_person_id
            order by prior.accepted_at desc limit 1
         ), ticket.email)`
      : "ticket.email";
  const row = (
    await query<{
      event_slug: string;
      event_title: string;
      holder_name: string;
      recipient_email: string;
      purchaser_email: string | null;
    }>(
      `select operation.event_slug,event.title as event_title,ticket.holder_name,
              operation.recipient_email,${senderEmail} as purchaser_email
         from ${table} operation
         join tickets ticket on ticket.id = operation.ticket_id
         join events event on event.slug = operation.event_slug
        where operation.id = $1`,
      [input.operationId],
    )
  )[0];
  if (!row) return;
  const descriptions = {
    accepted:
      input.kind === "transfer" ? "The ticket transfer was accepted." : "The ticket was claimed.",
    declined: "The ticket transfer was declined. The original holder keeps the ticket.",
    cancelled: `The ticket ${input.kind} invitation was cancelled.`,
    expired: `The ticket ${input.kind} invitation expired without being used.`,
    invalidated: "The ticket transfer invitation was invalidated by another ticket action.",
  } as const;
  const recipients = [...new Set([row.recipient_email, row.purchaser_email].filter(isValidEmail))];
  for (const recipient of recipients) {
    const delivery = await sendEmail(
      {
        channel: "access",
        to: recipient,
        subject: `${input.kind === "transfer" ? "Ticket transfer" : "Ticket assignment"} ${input.state} — ${row.event_title}`,
        text: `${descriptions[input.state]}\n\nEvent: ${row.event_title}\nTicket: ${row.holder_name}\n\nOpen milkandhenny.com/my for the current state. If this was not expected, contact hello@milkandhenny.com.`,
        html: renderBrandedEmail({
          origin: operationOrigin() ?? "https://milkandhenny.com",
          label: `ticket ${input.kind}`,
          title: `${input.kind === "transfer" ? "Transfer" : "Assignment"} ${input.state}`,
          meta: `${row.event_title} · ${row.holder_name}`,
          contentHtml: `<p>${escapeEmailHtml(descriptions[input.state])}</p>`,
          action: operationOrigin()
            ? { label: "open You", url: buildAppUrl(operationOrigin()!, "/my") }
            : undefined,
          note: "If this was not expected, contact hello@milkandhenny.com. Private resale and private payments are not supported.",
        }),
      },
      {
        idempotencyKey: `ticket-${input.kind}:${input.operationId}:${input.state}:${actionEmailHash(recipient)}`,
        kind: `ticket-${input.kind}`,
        source: "system",
        context:
          input.kind === "assignment"
            ? { eventSlug: row.event_slug, assignmentId: input.operationId }
            : { eventSlug: row.event_slug, transferId: input.operationId },
      },
    );
    if (!delivery.ok) {
      await emitDomainEvent({
        kind: "email.delivery_failed",
        deduplicationKey: `ticket-${input.kind}:${input.operationId}:${input.state}:email-failed:${actionEmailHash(recipient)}`,
        actorType: "system",
        eventSlug: row.event_slug,
        entityRefs: { operationId: input.operationId, state: input.state },
        severity: "warning",
        admin: {
          title: `Ticket ${input.kind} update was not delivered`,
          body: `The ${input.state} state is durable, but a customer update email failed.`,
          deepLink: "/admin?view=operations",
          category: "ticket-email-failure",
          createCase: true,
        },
      });
    }
  }
}

async function sendReturnLifecycle(input: {
  requestId: string;
  state: "confirmed" | "declined" | "cancelled" | "expired" | "failed";
  detail?: string;
}) {
  const row = (
    await query<{
      event_slug: string;
      event_title: string;
      holder_name: string;
      purchaser_email: string;
      holder_email: string | null;
    }>(
      `select request.event_slug,event.title as event_title,ticket.holder_name,
              ticket.email as purchaser_email,accepted.recipient_email as holder_email
         from ticket_return_requests request
         join tickets ticket on ticket.id = request.ticket_id
         join events event on event.slug = request.event_slug
         left join lateral (
           select recipient_email from ticket_transfers
            where ticket_id = request.ticket_id and status = 'accepted'
            order by accepted_at desc limit 1
         ) accepted on true
        where request.id = $1`,
      [input.requestId],
    )
  )[0];
  if (!row) return;
  const descriptions = {
    confirmed:
      "Both parties confirmed the ticket return. Any money due is being returned to the original payment method.",
    declined:
      "The other party declined the ticket return. The ticket remains with its current holder.",
    cancelled:
      "The ticket return request was cancelled. The ticket remains with its current holder.",
    expired: "The ticket return request expired without confirmation.",
    failed:
      "The return was confirmed, but the refund needs support review. The ticket remains unusable while we resolve it.",
  } as const;
  const description = `${descriptions[input.state]}${input.detail ? ` ${input.detail}` : ""}`;
  const recipients = [...new Set([row.purchaser_email, row.holder_email].filter(isValidEmail))];
  for (const recipient of recipients) {
    const delivery = await sendEmail(
      {
        channel: "tickets",
        to: recipient,
        subject: `Ticket return ${input.state} — ${row.event_title}`,
        text: `${description}\n\nEvent: ${row.event_title}\nTicket: ${row.holder_name}\n\nOpen milkandhenny.com/my for the durable current state. If this was not expected, contact hello@milkandhenny.com.`,
        html: renderBrandedEmail({
          origin: operationOrigin() ?? "https://milkandhenny.com",
          label: "ticket return",
          title: `Return ${input.state}`,
          meta: `${row.event_title} · ${row.holder_name}`,
          contentHtml: `<p>${escapeEmailHtml(description)}</p>`,
          action: operationOrigin()
            ? { label: "open You", url: buildAppUrl(operationOrigin()!, "/my") }
            : undefined,
          note: "Refunds return only to the original payment method. If this was not expected, contact hello@milkandhenny.com.",
        }),
      },
      {
        idempotencyKey: `ticket-return:${input.requestId}:${input.state}:${actionEmailHash(recipient)}`,
        kind: "ticket-return",
        source: "system",
        context: { eventSlug: row.event_slug, returnRequestId: input.requestId },
      },
    );
    if (!delivery.ok) {
      await emitDomainEvent({
        kind: "email.delivery_failed",
        deduplicationKey: `ticket-return:${input.requestId}:${input.state}:email-failed:${actionEmailHash(recipient)}`,
        actorType: "system",
        eventSlug: row.event_slug,
        entityRefs: { returnRequestId: input.requestId, state: input.state },
        severity: "warning",
        admin: {
          title: "Ticket return update was not delivered",
          body: "The return state is durable, but a customer update email failed.",
          deepLink: "/admin?view=operations",
          category: "ticket-email-failure",
          createCase: true,
        },
      });
    }
  }
}

export async function requestTicketAssignment(input: {
  ticketId: string;
  purchaserPersonId: string;
  recipientEmail: string;
  origin?: string;
}): Promise<TicketOperationResult<{ assignmentId: string; expiresAt: string }>> {
  if (!isValidEmail(input.recipientEmail))
    return { ok: false, status: 400, error: "Enter a valid recipient email" };
  const origin = operationOrigin(input.origin);
  if (!origin) return { ok: false, status: 503, error: "Public app URL is not configured" };
  const recipientEmail = normaliseEmail(input.recipientEmail);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  try {
    const created = await transaction(async (client) => {
      const selected = await client.query<{
        event_slug: string;
        title: string;
        holder_name: string;
        order_id: string;
        status: string;
        redeemed_at: Date | null;
        participant_id: string;
        person_id: string | null;
      }>(
        `select t.event_slug,e.title,t.holder_name,t.order_id,t.status,t.redeemed_at,
                p.id as participant_id,p.person_id
           from tickets t join events e on e.slug = t.event_slug
           join event_participants p on p.ticket_id = t.id
          where t.id = $1 for update of t,p`,
        [input.ticketId],
      );
      const ticket = selected.rows[0];
      if (!ticket) throw new TicketOperationError(404, "Ticket not found");
      const manager = await client.query(
        `select 1 from event_order_managers
          where order_id = $1 and person_id = $2 and status = 'active'`,
        [ticket.order_id, input.purchaserPersonId],
      );
      if (!manager.rowCount)
        throw new TicketOperationError(403, "Only an order manager can assign this ticket");
      if (ticket.status !== "valid" || ticket.redeemed_at)
        throw new TicketOperationError(409, "This ticket can no longer be assigned");
      if (ticket.person_id)
        throw new TicketOperationError(409, "This ticket is already claimed; use transfer instead");
      const activity = await client.query(
        `select 1 from score_postings where participant_id = $1 limit 1`,
        [ticket.participant_id],
      );
      if (activity.rowCount)
        throw new TicketOperationError(409, "This ticket has event activity and needs review");
      const assignmentId = id("assign");
      const link = await issueActionLink(client, {
        purpose: "ticket-assignment",
        intendedEmail: recipientEmail,
        entityType: "ticket-assignment",
        entityId: assignmentId,
        issuedByType: "attendee",
        issuedById: input.purchaserPersonId,
        expiresAt,
      });
      await client.query(
        `insert into ticket_assignments
           (id,event_slug,ticket_id,purchaser_person_id,recipient_email,recipient_email_hash,
            recipient_email_hint,action_link_id,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          assignmentId,
          ticket.event_slug,
          input.ticketId,
          input.purchaserPersonId,
          recipientEmail,
          actionEmailHash(recipientEmail),
          maskActionEmail(recipientEmail),
          link.id,
          expiresAt,
        ],
      );
      return { assignmentId, ticket, token: link.token };
    });
    const actionUrl = buildAppUrl(origin, `/action/${created.token}`);
    const delivery = await sendEmail(
      actionEmail({
        origin,
        recipient: recipientEmail,
        eventTitle: created.ticket.title,
        ticketLabel: created.ticket.holder_name,
        action: "assignment",
        actionUrl,
        expiresAt,
      }),
      {
        idempotencyKey: `ticket-assignment:${created.assignmentId}:invitation`,
        kind: "ticket-assignment",
        source: "self-service",
        context: {
          eventSlug: created.ticket.event_slug,
          ticketId: input.ticketId,
          assignmentId: created.assignmentId,
        },
      },
    );
    if (!delivery.ok) {
      await emitDomainEvent({
        kind: "email.delivery_failed",
        deduplicationKey: `assignment-email:${created.assignmentId}`,
        actorType: "system",
        eventSlug: created.ticket.event_slug,
        entityRefs: { assignmentId: created.assignmentId, ticketId: input.ticketId },
        severity: "warning",
        admin: {
          title: "Ticket assignment email failed",
          body: "The assignment remains pending, but the recipient may not have its link.",
          deepLink: `/admin?view=operations&ticket=${encodeURIComponent(input.ticketId)}`,
          category: "ticket-email-failure",
          createCase: true,
        },
      });
    }
    await emitDomainEvent({
      kind: "ticket.assignment_requested",
      deduplicationKey: `ticket-assignment:${created.assignmentId}:requested`,
      actorType: "attendee",
      actorId: input.purchaserPersonId,
      eventSlug: created.ticket.event_slug,
      entityRefs: { assignmentId: created.assignmentId, ticketId: input.ticketId },
    });
    return {
      ok: true,
      value: { assignmentId: created.assignmentId, expiresAt: expiresAt.toISOString() },
    };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "The assignment could not be created" };
  }
}

export async function requestTicketTransfer(input: {
  ticketId: string;
  senderPersonId: string;
  recipientEmail: string;
  origin?: string;
}): Promise<TicketOperationResult<{ transferId: string; expiresAt: string }>> {
  if (!isValidEmail(input.recipientEmail))
    return { ok: false, status: 400, error: "Enter a valid recipient email" };
  const origin = operationOrigin(input.origin);
  if (!origin) return { ok: false, status: 503, error: "Public app URL is not configured" };
  const recipientEmail = normaliseEmail(input.recipientEmail);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
  try {
    const created = await transaction(async (client) => {
      const selected = await client.query<{
        event_slug: string;
        title: string;
        holder_name: string;
        kind: string;
        status: string;
        redeemed_at: Date | null;
        participant_id: string;
        person_id: string | null;
      }>(
        `select t.event_slug,e.title,t.holder_name,t.kind,t.status,t.redeemed_at,
                p.id as participant_id,p.person_id
           from tickets t join events e on e.slug = t.event_slug
           join event_participants p on p.ticket_id = t.id
          where t.id = $1 for update of t,p`,
        [input.ticketId],
      );
      const ticket = selected.rows[0];
      if (!ticket) throw new TicketOperationError(404, "Ticket not found");
      if (ticket.person_id !== input.senderPersonId)
        throw new TicketOperationError(403, "Only the current holder can transfer this ticket");
      if (ticket.status !== "valid" || ticket.redeemed_at)
        throw new TicketOperationError(409, "This ticket can no longer be transferred");
      const globals = await client.query<{
        global_availability: unknown;
        emergency_paused: unknown;
        new_event_defaults: unknown;
      }>(
        `select global_availability,emergency_paused,new_event_defaults
           from attendee_operation_settings where id = true`,
      );
      const global = globals.rows[0];
      if (global) {
        await client.query(
          `insert into event_operation_policies
             (event_slug,capabilities,updated_by,update_reason)
           values ($1,$2::jsonb,'system','Snapshot on first transfer decision')
           on conflict (event_slug) do nothing`,
          [
            ticket.event_slug,
            JSON.stringify(
              capabilityMap(global.new_event_defaults, DEFAULT_NEW_EVENT_CAPABILITIES),
            ),
          ],
        );
      }
      const policies = await client.query<{
        capabilities: unknown;
        transfer_opens_at: Date | null;
        transfer_closes_at: Date | null;
        policy_version: string | number;
      }>(`select * from event_operation_policies where event_slug = $1 for update`, [
        ticket.event_slug,
      ]);
      const policy = policies.rows[0];
      if (!global || !policy)
        throw new TicketOperationError(409, "Transfers are not enabled for this event");
      const available = capabilityMap(global.global_availability, DEFAULT_GLOBAL_AVAILABILITY);
      const paused = capabilityMap(global.emergency_paused, DEFAULT_NEW_EVENT_CAPABILITIES);
      const eventCapabilities = capabilityMap(policy.capabilities, DEFAULT_NEW_EVENT_CAPABILITIES);
      const effective = effectiveCapability(
        { globalAvailability: available, emergencyPaused: paused },
        {
          capabilities: eventCapabilities,
          transferOpensAt: policy.transfer_opens_at?.toISOString(),
          transferClosesAt: policy.transfer_closes_at?.toISOString(),
        },
        "transfers",
      );
      if (!effective) throw new TicketOperationError(409, "Transfers are not open for this event");
      if (
        ticket.kind === "comp" &&
        !effectiveCapability(
          { globalAvailability: available, emergencyPaused: paused },
          {
            capabilities: eventCapabilities,
            transferOpensAt: policy.transfer_opens_at?.toISOString(),
            transferClosesAt: policy.transfer_closes_at?.toISOString(),
          },
          "complimentaryTransfers",
        )
      )
        throw new TicketOperationError(409, "Complimentary tickets cannot be transferred");
      const previous = await client.query(
        `select 1 from ticket_transfers where ticket_id = $1 and status = 'accepted' limit 1`,
        [input.ticketId],
      );
      if (
        previous.rowCount &&
        !effectiveCapability(
          { globalAvailability: available, emergencyPaused: paused },
          {
            capabilities: eventCapabilities,
            transferOpensAt: policy.transfer_opens_at?.toISOString(),
            transferClosesAt: policy.transfer_closes_at?.toISOString(),
          },
          "onwardTransfers",
        )
      )
        throw new TicketOperationError(409, "This transferred ticket cannot be transferred again");
      const conflicts = await client.query(
        `select 1 from ticket_exchanges
          where ticket_id = $1 and status in ('processing','awaiting_payment','refund_pending')
         union all
         select 1 from ticket_return_requests
          where ticket_id = $1 and status in ('awaiting-consent','confirmed','under-review','refund-pending')
         limit 1`,
        [input.ticketId],
      );
      if (conflicts.rowCount)
        throw new TicketOperationError(
          409,
          "A refund or exchange is already active for this ticket",
        );
      const activity = await client.query(
        `select 1 from score_postings where participant_id = $1 limit 1`,
        [ticket.participant_id],
      );
      const claims = await client.query(
        `select 1 from score_discovery_claims where participant_id = $1 limit 1`,
        [ticket.participant_id],
      );
      if (activity.rowCount || claims.rowCount)
        throw new TicketOperationError(
          409,
          "This ticket has event activity and needs admin review",
        );
      const transferId = id("transfer");
      const link = await issueActionLink(client, {
        purpose: "ticket-transfer",
        intendedEmail: recipientEmail,
        entityType: "ticket-transfer",
        entityId: transferId,
        issuedByType: "attendee",
        issuedById: input.senderPersonId,
        expiresAt,
      });
      await client.query(
        `insert into ticket_transfers
           (id,event_slug,ticket_id,sender_person_id,recipient_email,recipient_email_hash,
            recipient_email_hint,action_link_id,policy_version,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          transferId,
          ticket.event_slug,
          input.ticketId,
          input.senderPersonId,
          recipientEmail,
          actionEmailHash(recipientEmail),
          maskActionEmail(recipientEmail),
          link.id,
          Number(policy.policy_version),
          expiresAt,
        ],
      );
      return { transferId, ticket, token: link.token };
    });
    const actionUrl = buildAppUrl(origin, `/action/${created.token}`);
    const delivery = await sendEmail(
      actionEmail({
        origin,
        recipient: recipientEmail,
        eventTitle: created.ticket.title,
        ticketLabel: created.ticket.holder_name,
        action: "transfer",
        actionUrl,
        expiresAt,
      }),
      {
        idempotencyKey: `ticket-transfer:${created.transferId}:invitation`,
        kind: "ticket-transfer",
        source: "self-service",
        context: {
          eventSlug: created.ticket.event_slug,
          ticketId: input.ticketId,
          transferId: created.transferId,
        },
      },
    );
    if (!delivery.ok) {
      await emitDomainEvent({
        kind: "ticket.transfer_delivery_failed",
        deduplicationKey: `ticket-transfer:${created.transferId}:delivery-failed`,
        actorType: "system",
        eventSlug: created.ticket.event_slug,
        entityRefs: { transferId: created.transferId, ticketId: input.ticketId },
        severity: "warning",
        admin: {
          title: "Transfer invitation was not delivered",
          body: "The transfer remains pending, but its invitation email needs attention.",
          deepLink: `/admin?view=operations&ticket=${encodeURIComponent(input.ticketId)}`,
          category: "ticket-email-failure",
          createCase: true,
        },
      });
    }
    await emitDomainEvent({
      kind: "ticket.transfer_requested",
      deduplicationKey: `ticket-transfer:${created.transferId}:requested`,
      actorType: "attendee",
      actorId: input.senderPersonId,
      eventSlug: created.ticket.event_slug,
      entityRefs: { transferId: created.transferId, ticketId: input.ticketId },
    });
    return {
      ok: true,
      value: { transferId: created.transferId, expiresAt: expiresAt.toISOString() },
    };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "The transfer could not be created" };
  }
}

export async function requestTransferredTicketReturn(input: {
  ticketId: string;
  requesterPersonId: string;
  origin?: string;
}): Promise<
  TicketOperationResult<{ returnRequestId: string; expiresAt: string; emailQueued: boolean }>
> {
  const appOrigin = operationOrigin(input.origin);
  if (!appOrigin) return { ok: false, status: 503, error: "Application URL is not configured" };
  const expiresAt = new Date(Date.now() + 72 * 60 * 60_000);
  try {
    const created = await transaction(async (client) => {
      const selected = await client.query<{
        event_slug: string;
        order_id: string;
        holder_name: string;
        amount_paid_minor: number | null;
        currency: string | null;
        participant_id: string;
        holder_person_id: string | null;
        holder_email: string | null;
        purchaser_person_id: string;
        purchaser_email: string;
      }>(
        `select ticket.event_slug,ticket.order_id,ticket.holder_name,ticket.amount_paid_minor,
                ticket.currency,participant.id as participant_id,
                participant.person_id as holder_person_id,
                accepted.recipient_email as holder_email,
                purchaser.person_id as purchaser_person_id,ticket.email as purchaser_email
           from tickets ticket
           join event_participants participant on participant.ticket_id = ticket.id
           join lateral (
             select person_id from event_order_managers
              where order_id = ticket.order_id and status = 'active'
              order by created_at asc limit 1
           ) purchaser on true
           left join lateral (
             select recipient_email from ticket_transfers
              where ticket_id = ticket.id and status = 'accepted'
              order by accepted_at desc limit 1
           ) accepted on true
          where ticket.id = $1 and ticket.status = 'valid' and ticket.redeemed_at is null
            and ($2 = participant.person_id or $2 = purchaser.person_id)
          for update of ticket,participant`,
        [input.ticketId, input.requesterPersonId],
      );
      const ticket = selected.rows[0];
      if (!ticket) throw new TicketOperationError(404, "Returnable ticket not found");
      if (!ticket.holder_person_id || ticket.holder_person_id === ticket.purchaser_person_id)
        throw new TicketOperationError(409, "This ticket does not need another holder's consent");
      const requesterIsHolder = input.requesterPersonId === ticket.holder_person_id;
      const recipient = requesterIsHolder ? ticket.purchaser_email : ticket.holder_email;
      if (!recipient)
        throw new TicketOperationError(409, "The current holder email needs admin review");
      const active = await client.query(
        `select 1 from ticket_return_requests
          where ticket_id = $1 and status in ('awaiting-consent','confirmed','under-review','refund-pending')`,
        [input.ticketId],
      );
      if (active.rowCount)
        throw new TicketOperationError(409, "A return request is already active for this ticket");
      const pendingTransfers = await client.query<{ action_link_id: string | null }>(
        `update ticket_transfers
            set status = 'invalidated',invalidated_at = now(),
                invalidation_reason = 'refund-consent-requested',updated_at = now()
          where ticket_id = $1 and status = 'pending' returning action_link_id`,
        [input.ticketId],
      );
      for (const transfer of pendingTransfers.rows) {
        if (transfer.action_link_id)
          await revokeActionLink(client, transfer.action_link_id, "refund-consent-requested");
      }
      const returnRequestId = id("return");
      const link = await issueActionLink(client, {
        purpose: "refund-consent",
        intendedEmail: recipient,
        entityType: "ticket-return-request",
        entityId: returnRequestId,
        issuedByType: "attendee",
        issuedById: input.requesterPersonId,
        expiresAt,
      });
      await client.query(
        `insert into ticket_return_requests
           (id,event_slug,ticket_id,purchaser_person_id,holder_person_id,initiated_by_person_id,
            action_link_id,amount_minor,currency,status,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting-consent',$10)`,
        [
          returnRequestId,
          ticket.event_slug,
          input.ticketId,
          ticket.purchaser_person_id,
          ticket.holder_person_id,
          input.requesterPersonId,
          link.id,
          ticket.amount_paid_minor,
          ticket.currency,
          expiresAt,
        ],
      );
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason,correlation_id)
         values ('ticket.return.requested','attendee',$1,$2,'ticket-return-request',$3,null,
                 $4::jsonb,$5,$6)`,
        [
          input.requesterPersonId,
          ticket.event_slug,
          returnRequestId,
          JSON.stringify({ status: "awaiting-consent", ticketId: input.ticketId }),
          requesterIsHolder ? "current-holder-requested-return" : "purchaser-requested-refund",
          randomUUID(),
        ],
      );
      const eventRows = await client.query<{ title: string }>(
        `select title from events where slug = $1`,
        [ticket.event_slug],
      );
      return {
        returnRequestId,
        token: link.token,
        recipient,
        eventSlug: ticket.event_slug,
        eventTitle: eventRows.rows[0]?.title ?? ticket.event_slug,
        ticketLabel: ticket.holder_name,
      };
    });
    const rendered = actionEmail({
      origin: appOrigin,
      recipient: created.recipient,
      eventTitle: created.eventTitle,
      ticketLabel: created.ticketLabel,
      action: "return",
      actionUrl: buildAppUrl(appOrigin, `/action/${created.token}`),
      expiresAt,
    });
    const delivery = await sendEmail(
      {
        channel: "tickets",
        to: created.recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      },
      {
        idempotencyKey: `refund-consent:${created.returnRequestId}`,
        kind: "ticket-return",
        source: "self-service",
        context: {
          eventSlug: created.eventSlug,
          ticketId: input.ticketId,
          returnRequestId: created.returnRequestId,
        },
      },
    );
    if (!delivery.ok) {
      await emitDomainEvent({
        kind: "ticket.return_email_failed",
        deduplicationKey: `ticket-return:${created.returnRequestId}:email-failed`,
        actorType: "system",
        eventSlug: created.eventSlug,
        entityRefs: { ticketId: input.ticketId, returnRequestId: created.returnRequestId },
        severity: "warning",
        admin: {
          title: "Refund consent email failed",
          body: "The return request remains pending, but the current holder may not have its link.",
          deepLink: `/admin?view=operations&ticket=${encodeURIComponent(input.ticketId)}`,
          category: "refund-consent-email-failed",
          createCase: true,
        },
      });
    }
    return {
      ok: true,
      value: {
        returnRequestId: created.returnRequestId,
        expiresAt: expiresAt.toISOString(),
        emailQueued: delivery.ok,
      },
    };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "Refund consent could not be requested" };
  }
}

export async function acceptRefundConsent(token: string): Promise<
  TicketOperationResult<{
    state: "succeeded" | "pending";
    refunded: number;
    emailQueued: boolean;
    destination: string;
    mfaRequired: boolean;
  }>
> {
  try {
    const consumed = await consumeActionLink(token, async (client, link) => {
      if (link.purpose !== "refund-consent")
        throw new TicketOperationError(400, "This link is not a refund consent request");
      const person = await createOrResolveInvitedPerson(client, link);
      const rows = await client.query<{ id: string; ticket_id: string; event_slug: string }>(
        `update ticket_return_requests
            set status = 'confirmed',consented_at = now(),updated_at = now()
          where id = $1 and status = 'awaiting-consent'
            and $2 in (purchaser_person_id,holder_person_id)
            and $2 <> initiated_by_person_id
          returning id,ticket_id,event_slug`,
        [link.entityId, person.personId],
      );
      const request = rows.rows[0];
      if (!request)
        throw new TicketOperationError(
          409,
          "This consent link does not match the ticket's other verified party",
        );
      await client.query(`update attendee_action_links set consumed_by = $2 where id = $1`, [
        link.id,
        person.personId,
      ]);
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason,correlation_id)
         values ('ticket.return.consented','attendee',$1,$2,'ticket-return-request',$3,
                 '{"status":"awaiting-consent"}'::jsonb,'{"status":"confirmed"}'::jsonb,
                 'current-holder-consented',$4)`,
        [person.personId, request.event_slug, request.id, randomUUID()],
      );
      return {
        requestId: request.id,
        ticketId: request.ticket_id,
        personId: person.personId,
        verifiedEmailHash: link.intendedEmailHash,
      };
    });
    if (!consumed.ok) return consumed;
    const authentication = await establishEmailAuthenticatedSession({
      personId: consumed.value.personId,
      verifiedEmailHash: consumed.value.verifiedEmailHash,
      returnTo: "/my",
    });
    const refunded = await refundTicket({
      ticketId: consumed.value.ticketId,
      reason: "self-serve",
      actorId: consumed.value.personId,
      returnRequestId: consumed.value.requestId,
    });
    await sendReturnLifecycle({
      requestId: consumed.value.requestId,
      state: refunded.ok ? "confirmed" : "failed",
      detail: refunded.ok
        ? refunded.value.state === "pending"
          ? "The payment provider is still processing the refund."
          : undefined
        : refunded.error,
    });
    return refunded.ok ? { ok: true, value: { ...refunded.value, ...authentication } } : refunded;
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "Refund consent could not be completed" };
  }
}

export async function declineRefundConsent(
  token: string,
): Promise<TicketOperationResult<{ declined: true }>> {
  try {
    const consumed = await consumeActionLink(token, async (client, link) => {
      if (link.purpose !== "refund-consent")
        throw new TicketOperationError(400, "This link is not a refund consent request");
      const person = await createOrResolveInvitedPerson(client, link);
      const rows = await client.query<{ id: string; event_slug: string; ticket_id: string }>(
        `update ticket_return_requests
            set status = 'declined',resolved_at = now(),resolution_reason = 'holder-declined',updated_at = now()
          where id = $1 and status = 'awaiting-consent'
            and $2 in (purchaser_person_id,holder_person_id)
            and $2 <> initiated_by_person_id
          returning id,event_slug,ticket_id`,
        [link.entityId, person.personId],
      );
      const row = rows.rows[0];
      if (!row) throw new TicketOperationError(409, "This request is no longer available");
      await client.query(`update attendee_action_links set consumed_by = $2 where id = $1`, [
        link.id,
        person.personId,
      ]);
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
         values ('ticket.return.declined','attendee',$1,$2,'ticket-return-request',$3,
                 '{"status":"awaiting-consent"}'::jsonb,'{"status":"declined"}'::jsonb,
                 'current-holder-declined')`,
        [person.personId, row.event_slug, link.entityId],
      );
      return row;
    });
    if (!consumed.ok) return consumed;
    await sendReturnLifecycle({ requestId: consumed.value.id, state: "declined" });
    return { ok: true, value: { declined: true } };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "Refund consent could not be declined" };
  }
}

export async function acceptTicketAction(token: string): Promise<
  TicketOperationResult<{
    purpose: "ticket-assignment" | "ticket-transfer";
    personId: string;
    verifiedEmailHash: string;
    ticketId: string;
    publicTicketId: string;
    eventSlug: string;
    operationId: string;
    destination: string;
    mfaRequired: boolean;
  }>
> {
  try {
    const consumed = await consumeActionLink(token, async (client, link) => {
      if (link.purpose !== "ticket-assignment" && link.purpose !== "ticket-transfer")
        throw new TicketOperationError(400, "This link is for a different action");
      const person = await createOrResolveInvitedPerson(client, link);
      if (link.purpose === "ticket-assignment") {
        const selected = await client.query<{
          ticket_id: string;
          event_slug: string;
          status: string;
          expires_at: Date;
          participant_id: string;
          person_id: string | null;
          ticket_status: string;
          redeemed_at: Date | null;
        }>(
          `select assignment.ticket_id,assignment.event_slug,assignment.status,assignment.expires_at,
                  participant.id as participant_id,participant.person_id,
                  ticket.status as ticket_status,ticket.redeemed_at
             from ticket_assignments assignment
             join tickets ticket on ticket.id = assignment.ticket_id
             join event_participants participant on participant.ticket_id = ticket.id
            where assignment.id = $1 for update of assignment,ticket,participant`,
          [link.entityId],
        );
        const assignment = selected.rows[0];
        if (!assignment || assignment.status !== "pending")
          throw new TicketOperationError(409, "This assignment is no longer available");
        if (assignment.expires_at <= new Date())
          throw new TicketOperationError(410, "This assignment has expired");
        if (assignment.ticket_status !== "valid" || assignment.redeemed_at)
          throw new TicketOperationError(409, "This ticket is no longer claimable");
        if (assignment.person_id && assignment.person_id !== person.personId)
          throw new TicketOperationError(409, "This ticket belongs to someone else");
        await attachTicketPerson(client, {
          eventSlug: assignment.event_slug,
          ticketId: assignment.ticket_id,
          participantId: assignment.participant_id,
          personId: person.personId,
          identifierId: person.identifierId,
          previousPersonId: null,
          source: "assignment",
        });
        await client.query(
          `update ticket_assignments
              set status = 'claimed',claimed_by_person_id = $2,claimed_at = now(),updated_at = now()
            where id = $1`,
          [link.entityId, person.personId],
        );
        return {
          purpose: "ticket-assignment" as const,
          personId: person.personId,
          verifiedEmailHash: link.intendedEmailHash,
          ticketId: assignment.ticket_id,
          publicTicketId: assignment.ticket_id,
          eventSlug: assignment.event_slug,
          operationId: link.entityId,
        };
      }

      const selected = await client.query<{
        ticket_id: string;
        event_slug: string;
        sender_person_id: string;
        status: string;
        expires_at: Date;
        participant_id: string;
        person_id: string | null;
        ticket_status: string;
        kind: string;
        redeemed_at: Date | null;
      }>(
        `select transfer.ticket_id,transfer.event_slug,transfer.sender_person_id,
                transfer.status,transfer.expires_at,participant.id as participant_id,
                participant.person_id,ticket.status as ticket_status,ticket.kind,ticket.redeemed_at
           from ticket_transfers transfer
           join tickets ticket on ticket.id = transfer.ticket_id
           join event_participants participant on participant.ticket_id = ticket.id
          where transfer.id = $1 for update of transfer,ticket,participant`,
        [link.entityId],
      );
      const transfer = selected.rows[0];
      if (!transfer || transfer.status !== "pending")
        throw new TicketOperationError(409, "This transfer is no longer available");
      if (transfer.expires_at <= new Date())
        throw new TicketOperationError(410, "This transfer has expired");
      if (transfer.ticket_status !== "valid" || transfer.redeemed_at)
        throw new TicketOperationError(409, "This ticket can no longer be transferred");
      if (transfer.person_id !== transfer.sender_person_id)
        throw new TicketOperationError(409, "The ticket holder changed before acceptance");
      const globals = await client.query<{
        global_availability: unknown;
        emergency_paused: unknown;
      }>(
        `select global_availability,emergency_paused from attendee_operation_settings where id = true`,
      );
      const policies = await client.query<{
        capabilities: unknown;
        transfer_opens_at: Date | null;
        transfer_closes_at: Date | null;
      }>(`select * from event_operation_policies where event_slug = $1`, [transfer.event_slug]);
      const global = globals.rows[0];
      const policy = policies.rows[0];
      const available = capabilityMap(global?.global_availability, DEFAULT_GLOBAL_AVAILABILITY);
      const paused = capabilityMap(global?.emergency_paused, DEFAULT_NEW_EVENT_CAPABILITIES);
      const eventCapabilities = capabilityMap(policy?.capabilities, DEFAULT_NEW_EVENT_CAPABILITIES);
      if (
        !global ||
        !policy ||
        !effectiveCapability(
          {
            globalAvailability: available,
            emergencyPaused: paused,
          },
          {
            capabilities: eventCapabilities,
            transferOpensAt: policy.transfer_opens_at?.toISOString(),
            transferClosesAt: policy.transfer_closes_at?.toISOString(),
          },
          "transfers",
        )
      ) {
        throw new TicketOperationError(409, "Transfers are no longer open for this event");
      }
      if (
        transfer.kind === "comp" &&
        !effectiveCapability(
          { globalAvailability: available, emergencyPaused: paused },
          {
            capabilities: eventCapabilities,
            transferOpensAt: policy.transfer_opens_at?.toISOString(),
            transferClosesAt: policy.transfer_closes_at?.toISOString(),
          },
          "complimentaryTransfers",
        )
      ) {
        throw new TicketOperationError(409, "Complimentary transfers are no longer available");
      }
      const previous = await client.query(
        `select 1 from ticket_transfers
          where ticket_id = $1 and status = 'accepted' and id <> $2 limit 1`,
        [transfer.ticket_id, link.entityId],
      );
      if (
        previous.rowCount &&
        !effectiveCapability(
          { globalAvailability: available, emergencyPaused: paused },
          {
            capabilities: eventCapabilities,
            transferOpensAt: policy.transfer_opens_at?.toISOString(),
            transferClosesAt: policy.transfer_closes_at?.toISOString(),
          },
          "onwardTransfers",
        )
      ) {
        throw new TicketOperationError(409, "Onward transfers are no longer available");
      }
      const conflict = await client.query(
        `select 1 from ticket_exchanges
          where ticket_id = $1 and status in ('processing','awaiting_payment','refund_pending')
         union all select 1 from ticket_return_requests
          where ticket_id = $1 and status in ('awaiting-consent','confirmed','under-review','refund-pending')
         limit 1`,
        [transfer.ticket_id],
      );
      const activity = await client.query(
        `select 1 from score_postings where participant_id = $1 limit 1`,
        [transfer.participant_id],
      );
      if (conflict.rowCount || activity.rowCount)
        throw new TicketOperationError(409, "This transfer now conflicts with ticket activity");
      const publicTicketId = generateTicketId();
      await attachTicketPerson(client, {
        eventSlug: transfer.event_slug,
        ticketId: transfer.ticket_id,
        participantId: transfer.participant_id,
        personId: person.personId,
        identifierId: person.identifierId,
        previousPersonId: transfer.sender_person_id,
        source: "transfer",
      });
      await client.query(
        `update tickets
            set access_reference = $2,authority_version = authority_version + 1,
                holder_name = coalesce((select canonical_name from event_people where id = $3), holder_name)
          where id = $1`,
        [transfer.ticket_id, publicTicketId, person.personId],
      );
      await client.query(
        `update ticket_transfers
            set status = 'accepted',accepted_by_person_id = $2,accepted_at = now(),updated_at = now()
          where id = $1`,
        [link.entityId, person.personId],
      );
      return {
        purpose: "ticket-transfer" as const,
        personId: person.personId,
        verifiedEmailHash: link.intendedEmailHash,
        ticketId: transfer.ticket_id,
        publicTicketId,
        eventSlug: transfer.event_slug,
        operationId: link.entityId,
      };
    });
    if (!consumed.ok) return consumed;
    const authentication = await establishEmailAuthenticatedSession({
      personId: consumed.value.personId,
      verifiedEmailHash: consumed.value.verifiedEmailHash,
      returnTo: `/ticket/${consumed.value.publicTicketId}`,
    });
    await emitDomainEvent({
      kind:
        consumed.value.purpose === "ticket-transfer"
          ? "ticket.transfer_accepted"
          : "ticket.assignment_accepted",
      deduplicationKey: `${consumed.value.purpose}:${consumed.value.ticketId}:accepted:${consumed.value.personId}`,
      actorType: "attendee",
      actorId: consumed.value.personId,
      eventSlug: consumed.value.eventSlug,
      entityRefs: { ticketId: consumed.value.ticketId },
    });
    await sendOperationLifecycle({
      kind: consumed.value.purpose === "ticket-transfer" ? "transfer" : "assignment",
      operationId: consumed.value.operationId,
      state: "accepted",
    });
    return { ok: true, value: { ...consumed.value, ...authentication } };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "This ticket action could not be completed" };
  }
}

export async function inspectTicketAction(token: string): Promise<{
  purpose: "ticket-assignment" | "ticket-transfer" | "ticket-return" | "refund-consent";
  state: "available" | "expired" | "cancelled" | "completed";
  eventTitle?: string;
  ticketLabel?: string;
  intendedEmailHint?: string;
  expiresAt?: string;
} | null> {
  const link = await inspectActionLink(token);
  if (!link) return null;
  if (link.purpose === "refund-consent" || link.purpose === "ticket-return") {
    const rows = await query<{
      status: string;
      event_title: string;
      holder_name: string;
    }>(
      `select request.status,event.title as event_title,ticket.holder_name
         from ticket_return_requests request
         join tickets ticket on ticket.id = request.ticket_id
         join events event on event.slug = request.event_slug
        where request.id = $1`,
      [link.entityId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      purpose: link.purpose,
      state:
        link.expiresAt <= new Date().toISOString()
          ? "expired"
          : row.status === "awaiting-consent"
            ? "available"
            : row.status === "declined" || row.status === "cancelled" || row.status === "failed"
              ? "cancelled"
              : "completed",
      eventTitle: row.event_title,
      ticketLabel: row.holder_name,
      intendedEmailHint: link.intendedEmailHint,
      expiresAt: link.expiresAt,
    };
  }
  if (link.purpose !== "ticket-assignment" && link.purpose !== "ticket-transfer") {
    return null;
  }
  const table = link.purpose === "ticket-assignment" ? "ticket_assignments" : "ticket_transfers";
  const rows = await query<{
    status: string;
    expires_at: Date | null;
    event_title: string;
    holder_name: string;
  }>(
    `select operation.status,operation.expires_at,event.title as event_title,ticket.holder_name
       from ${table} operation
       join tickets ticket on ticket.id = operation.ticket_id
       join events event on event.slug = operation.event_slug
      where operation.id = $1`,
    [link.entityId],
  );
  const row = rows[0];
  if (!row) return null;
  const availableStatus = link.purpose === "ticket-assignment" ? "pending" : "pending";
  const state =
    row.expires_at && row.expires_at <= new Date()
      ? "expired"
      : row.status === availableStatus
        ? "available"
        : row.status === "cancelled" || row.status === "declined" || row.status === "invalidated"
          ? "cancelled"
          : "completed";
  return {
    purpose: link.purpose,
    state,
    eventTitle: row.event_title,
    ticketLabel: row.holder_name,
    intendedEmailHint: link.intendedEmailHint,
    expiresAt: row.expires_at?.toISOString() ?? link.expiresAt,
  };
}

export async function declineTicketTransfer(
  token: string,
): Promise<TicketOperationResult<{ declined: true }>> {
  try {
    const consumed = await consumeActionLink(token, async (client, link) => {
      if (link.purpose !== "ticket-transfer")
        throw new TicketOperationError(400, "This link is not a transfer invitation");
      const rows = await client.query<{ event_slug: string; ticket_id: string }>(
        `update ticket_transfers
            set status = 'declined',declined_at = now(),updated_at = now()
          where id = $1 and status = 'pending' and expires_at > now()
          returning event_slug,ticket_id`,
        [link.entityId],
      );
      const row = rows.rows[0];
      if (!row) throw new TicketOperationError(409, "This transfer is no longer available");
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,event_slug,entity_type,entity_id,after_state)
         values ('ticket.transfer.declined','attendee',$1,'ticket-transfer',$2,
                 '{"status":"declined"}'::jsonb)`,
        [row.event_slug, link.entityId],
      );
      return { ...row, operationId: link.entityId };
    });
    if (!consumed.ok) return consumed;
    await emitDomainEvent({
      kind: "ticket.transfer_declined",
      deduplicationKey: `ticket-transfer:${token.slice(-12)}:declined`,
      actorType: "attendee",
      eventSlug: consumed.value.event_slug,
      entityRefs: { ticketId: consumed.value.ticket_id },
    });
    await sendOperationLifecycle({
      kind: "transfer",
      operationId: consumed.value.operationId,
      state: "declined",
    });
    return { ok: true, value: { declined: true } };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "The transfer could not be declined" };
  }
}

async function attachTicketPerson(
  client: PoolClient,
  input: {
    eventSlug: string;
    ticketId: string;
    participantId: string;
    personId: string;
    identifierId: string;
    previousPersonId: string | null;
    source: "assignment" | "transfer";
  },
): Promise<void> {
  if (input.previousPersonId) {
    await client.query(
      `update event_ticket_identity_claims
          set status = 'released',released_at = now(),release_reason = 'accepted-transfer'
        where ticket_id = $1 and status = 'active'`,
      [input.ticketId],
    );
  }
  await client.query(
    `update event_participants set person_id = $2,updated_at = now() where id = $1`,
    [input.participantId, input.personId],
  );
  await client.query(
    `insert into event_ticket_identity_claims
       (id,event_slug,ticket_id,participant_id,person_id,identifier_id,source)
     values ($1,$2,$3,$4,$5,$6,'ticket-and-email')`,
    [
      id("ticketclaim"),
      input.eventSlug,
      input.ticketId,
      input.participantId,
      input.personId,
      input.identifierId,
    ],
  );
  await client.query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,correlation_id)
     values ($1,'attendee',$2,$3,'ticket',$4,$5::jsonb,$6::jsonb,$7)`,
    [
      `ticket.${input.source}.accepted`,
      input.personId,
      input.eventSlug,
      input.ticketId,
      JSON.stringify({ holderPersonId: input.previousPersonId }),
      JSON.stringify({ holderPersonId: input.personId }),
      randomUUID(),
    ],
  );
}

export async function cancelPendingTicketOperation(input: {
  kind: "assignment" | "transfer";
  operationId: string;
  actorPersonId: string;
}): Promise<TicketOperationResult<{ cancelled: true }>> {
  try {
    await transaction(async (client) => {
      const table = input.kind === "assignment" ? "ticket_assignments" : "ticket_transfers";
      const ownerColumn = input.kind === "assignment" ? "purchaser_person_id" : "sender_person_id";
      const selected = await client.query<{
        action_link_id: string | null;
        event_slug: string;
        ticket_id: string;
      }>(
        `select action_link_id,event_slug,ticket_id from ${table}
          where id = $1 and ${ownerColumn} = $2 and status = 'pending' for update`,
        [input.operationId, input.actorPersonId],
      );
      const row = selected.rows[0];
      if (!row) throw new TicketOperationError(404, "Pending operation not found");
      await client.query(
        `update ${table} set status = 'cancelled',cancelled_at = now(),updated_at = now() where id = $1`,
        [input.operationId],
      );
      if (row.action_link_id)
        await revokeActionLink(client, row.action_link_id, "cancelled-by-sender");
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,after_state)
         values ($1,'attendee',$2,$3,$4,$5,'{"status":"cancelled"}'::jsonb)`,
        [
          `ticket.${input.kind}.cancelled`,
          input.actorPersonId,
          row.event_slug,
          `ticket-${input.kind}`,
          input.operationId,
        ],
      );
    });
    await sendOperationLifecycle({
      kind: input.kind,
      operationId: input.operationId,
      state: "cancelled",
    });
    return { ok: true, value: { cancelled: true } };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "The operation could not be cancelled" };
  }
}

export async function cancelTransferredTicketReturn(input: {
  returnRequestId: string;
  actorPersonId: string;
}): Promise<TicketOperationResult<{ cancelled: true }>> {
  try {
    await transaction(async (client) => {
      const selected = await client.query<{
        action_link_id: string | null;
        event_slug: string;
      }>(
        `update ticket_return_requests
            set status = 'cancelled',resolved_at = now(),resolution_reason = 'initiator-cancelled',
                updated_at = now()
          where id = $1 and initiated_by_person_id = $2 and status = 'awaiting-consent'
          returning action_link_id,event_slug`,
        [input.returnRequestId, input.actorPersonId],
      );
      const request = selected.rows[0];
      if (!request) throw new TicketOperationError(404, "Pending return request not found");
      if (request.action_link_id)
        await revokeActionLink(client, request.action_link_id, "cancelled-by-initiator");
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,after_state,reason)
         values ('ticket.return.cancelled','attendee',$1,$2,'ticket-return-request',$3,
                 '{"status":"cancelled"}'::jsonb,'initiator cancelled return')`,
        [input.actorPersonId, request.event_slug, input.returnRequestId],
      );
    });
    await sendReturnLifecycle({ requestId: input.returnRequestId, state: "cancelled" });
    return { ok: true, value: { cancelled: true } };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "The return request could not be cancelled" };
  }
}

export async function resendPendingTicketOperation(input: {
  kind: "assignment" | "transfer";
  operationId: string;
  actorPersonId: string;
  origin?: string;
}): Promise<TicketOperationResult<{ expiresAt: string; emailQueued: boolean }>> {
  const origin = operationOrigin(input.origin);
  if (!origin) return { ok: false, status: 503, error: "Public app URL is not configured" };
  try {
    const expiresAt = new Date(
      Date.now() + (input.kind === "assignment" ? 7 * 24 : 48) * 60 * 60 * 1_000,
    );
    const created = await transaction(async (client) => {
      const table = input.kind === "assignment" ? "ticket_assignments" : "ticket_transfers";
      const ownerColumn = input.kind === "assignment" ? "purchaser_person_id" : "sender_person_id";
      const selected = await client.query<{
        action_link_id: string | null;
        event_slug: string;
        event_title: string;
        holder_name: string;
        recipient_email: string;
      }>(
        `select operation.action_link_id,operation.event_slug,event.title as event_title,
                ticket.holder_name,operation.recipient_email
           from ${table} operation
           join tickets ticket on ticket.id = operation.ticket_id
           join events event on event.slug = operation.event_slug
          where operation.id = $1 and operation.${ownerColumn} = $2
            and operation.status = 'pending' for update of operation`,
        [input.operationId, input.actorPersonId],
      );
      const operation = selected.rows[0];
      if (!operation) throw new TicketOperationError(404, "Pending operation not found");
      if (operation.action_link_id) {
        await revokeActionLink(client, operation.action_link_id, "replaced-by-resend");
      }
      const link = await issueActionLink(client, {
        purpose: input.kind === "assignment" ? "ticket-assignment" : "ticket-transfer",
        intendedEmail: operation.recipient_email,
        entityType: `ticket-${input.kind}`,
        entityId: input.operationId,
        issuedByType: "attendee",
        issuedById: input.actorPersonId,
        expiresAt,
      });
      await client.query(
        `update ${table}
            set action_link_id = $2,expires_at = $3,updated_at = now()
          where id = $1`,
        [input.operationId, link.id, expiresAt],
      );
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,reason)
         values ($1,'attendee',$2,$3,$4,$5,'invitation resent')`,
        [
          `ticket.${input.kind}.resent`,
          input.actorPersonId,
          operation.event_slug,
          `ticket-${input.kind}`,
          input.operationId,
        ],
      );
      return { ...operation, token: link.token };
    });
    const delivery = await sendEmail(
      actionEmail({
        origin,
        recipient: created.recipient_email,
        eventTitle: created.event_title,
        ticketLabel: created.holder_name,
        action: input.kind,
        actionUrl: buildAppUrl(origin, `/action/${created.token}`),
        expiresAt,
      }),
      {
        idempotencyKey: `ticket-${input.kind}:${input.operationId}:resend:${expiresAt.toISOString()}`,
        kind: `ticket-${input.kind}`,
        source: "self-service",
        context:
          input.kind === "assignment"
            ? { eventSlug: created.event_slug, assignmentId: input.operationId }
            : { eventSlug: created.event_slug, transferId: input.operationId },
      },
    );
    return {
      ok: true,
      value: { expiresAt: expiresAt.toISOString(), emailQueued: delivery.ok },
    };
  } catch (error) {
    return error instanceof TicketOperationError
      ? { ok: false, status: error.status, error: error.message }
      : {
          ok: false,
          status: error instanceof Error && error.message.startsWith("Too many") ? 429 : 503,
          error: error instanceof Error ? error.message : "The invitation could not be resent",
        };
  }
}

export async function ticketOperationsForPerson(personId: string) {
  const [
    incomingAssignments,
    incomingTransfers,
    outgoingAssignments,
    outgoingTransfers,
    returnRequests,
  ] = await Promise.all([
    query<{
      id: string;
      ticket_id: string;
      event_slug: string;
      event_title: string;
      status: string;
      expires_at: Date;
    }>(
      `select assignment.id,assignment.ticket_id,assignment.event_slug,event.title as event_title,
                assignment.status,assignment.expires_at
           from ticket_assignments assignment join events event on event.slug = assignment.event_slug
           join event_person_identifiers identifier
             on identifier.value_hash = assignment.recipient_email_hash and identifier.person_id = $1
          order by assignment.created_at desc`,
      [personId],
    ),
    query<{
      id: string;
      ticket_id: string;
      event_slug: string;
      event_title: string;
      status: string;
      expires_at: Date;
    }>(
      `select transfer.id,transfer.ticket_id,transfer.event_slug,event.title as event_title,
                transfer.status,transfer.expires_at
           from ticket_transfers transfer join events event on event.slug = transfer.event_slug
           join event_person_identifiers identifier
             on identifier.value_hash = transfer.recipient_email_hash and identifier.person_id = $1
          order by transfer.created_at desc`,
      [personId],
    ),
    query<{
      id: string;
      ticket_id: string;
      event_slug: string;
      event_title: string;
      status: string;
      expires_at: Date;
    }>(
      `select assignment.id,assignment.ticket_id,assignment.event_slug,event.title as event_title,
                assignment.status,assignment.expires_at
           from ticket_assignments assignment join events event on event.slug = assignment.event_slug
          where assignment.purchaser_person_id = $1 order by assignment.created_at desc`,
      [personId],
    ),
    query<{
      id: string;
      ticket_id: string;
      event_slug: string;
      event_title: string;
      status: string;
      expires_at: Date;
    }>(
      `select transfer.id,transfer.ticket_id,transfer.event_slug,event.title as event_title,
                transfer.status,transfer.expires_at
           from ticket_transfers transfer join events event on event.slug = transfer.event_slug
          where transfer.sender_person_id = $1 order by transfer.created_at desc`,
      [personId],
    ),
    query<{
      id: string;
      ticket_id: string;
      event_slug: string;
      event_title: string;
      status: string;
      expires_at: Date;
      initiated_by_person_id: string;
    }>(
      `select request.id,request.ticket_id,request.event_slug,event.title as event_title,
                request.status,request.expires_at,request.initiated_by_person_id
           from ticket_return_requests request
           join events event on event.slug = request.event_slug
          where $1 in (request.purchaser_person_id,request.holder_person_id)
          order by request.created_at desc`,
      [personId],
    ),
  ]);
  const map = (row: (typeof incomingAssignments)[number]) => ({
    id: row.id,
    ticketId: row.ticket_id,
    eventSlug: row.event_slug,
    eventTitle: row.event_title,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
  });
  return {
    incomingAssignments: incomingAssignments.map(map),
    incomingTransfers: incomingTransfers.map(map),
    outgoingAssignments: outgoingAssignments.map(map),
    outgoingTransfers: outgoingTransfers.map(map),
    returnRequests: returnRequests.map((row) => ({
      ...map(row),
      canCancel: row.initiated_by_person_id === personId && row.status === "awaiting-consent",
    })),
  };
}

export async function expireTicketOperations(): Promise<{
  assignments: number;
  transfers: number;
  returns: number;
}> {
  const expired = await transaction(async (client) => {
    const assignments = await client.query<{ id: string; action_link_id: string | null }>(
      `update ticket_assignments set status = 'expired',updated_at = now()
        where status = 'pending' and expires_at <= now() returning id,action_link_id`,
    );
    const transfers = await client.query<{ id: string; action_link_id: string | null }>(
      `update ticket_transfers set status = 'expired',updated_at = now()
        where status = 'pending' and expires_at <= now() returning id,action_link_id`,
    );
    const returns = await client.query<{ id: string; action_link_id: string | null }>(
      `update ticket_return_requests
          set status = 'expired',resolved_at = now(),resolution_reason = 'consent-expired',updated_at = now()
        where status = 'awaiting-consent' and expires_at <= now() returning id,action_link_id`,
    );
    for (const row of [...assignments.rows, ...transfers.rows, ...returns.rows]) {
      if (row.action_link_id) await revokeActionLink(client, row.action_link_id, "expired");
    }
    return { assignments: assignments.rows, transfers: transfers.rows, returns: returns.rows };
  });
  await Promise.all([
    ...expired.assignments.map((assignment) =>
      sendOperationLifecycle({
        kind: "assignment",
        operationId: assignment.id,
        state: "expired",
      }),
    ),
    ...expired.transfers.map((transfer) =>
      sendOperationLifecycle({
        kind: "transfer",
        operationId: transfer.id,
        state: "expired",
      }),
    ),
    ...expired.returns.map((request) =>
      sendReturnLifecycle({ requestId: request.id, state: "expired" }),
    ),
  ]);
  return {
    assignments: expired.assignments.length,
    transfers: expired.transfers.length,
    returns: expired.returns.length,
  };
}
