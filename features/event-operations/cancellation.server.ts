import { createHash, randomUUID } from "node:crypto";

import { emitDomainEvent } from "@/features/attendee-operations/notifications.server";
import { refundOrder } from "@/features/tickets/checkout.server";
import { sendEmail } from "@/lib/platform/email.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";

export type EventCancellationResult = {
  orders: number;
  refundedOrders: number;
  failedOrders: number;
  voidedComplimentaryTickets: number;
  holderEmailsQueued: number;
};

/** Whether this update begins cancellation rather than editing one already completed. */
export async function eventCancellationPending(
  eventSlug: string,
  requestedStatus: unknown,
): Promise<boolean> {
  if (requestedStatus !== "cancelled") return false;
  const rows = await query<{ status: string; completed: boolean }>(
    `select event.status,
            exists (
              select 1 from attendee_operations_audit_events audit
               where audit.event_slug = event.slug
                 and audit.action = 'event.cancellation.completed'
            ) as completed
       from events event where event.slug = $1`,
    [eventSlug],
  );
  return Boolean(rows[0] && (rows[0].status !== "cancelled" || !rows[0].completed));
}

export async function runEventCancellation(input: {
  eventSlug: string;
  actorId: string;
  actorType: "root-owner" | "admin";
  reason: string;
  origin?: string;
}): Promise<EventCancellationResult> {
  if (!input.reason.trim()) throw new Error("An event cancellation reason is required");
  const appOrigin =
    input.origin?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.VITE_BASE_URL?.trim() ||
    "";
  const [eventRows, orders, holders] = await Promise.all([
    query<{ title: string; status: string }>(`select title,status from events where slug = $1`, [
      input.eventSlug,
    ]),
    query<{ order_id: string; ticket_id: string }>(
      `select distinct on (order_id) order_id,id as ticket_id from tickets
        where event_slug = $1 and payment_ref is not null
        order by order_id,parent_ticket_id nulls first,issued_at,id`,
      [input.eventSlug],
    ),
    query<{ ticket_id: string; email: string }>(
      `select ticket.id as ticket_id,
              coalesce(accepted.recipient_email,assigned.recipient_email,ticket.email) as email
         from tickets ticket
         left join lateral (
           select recipient_email from ticket_transfers
            where ticket_id = ticket.id and status = 'accepted'
            order by accepted_at desc limit 1
         ) accepted on true
         left join lateral (
           select recipient_email from ticket_assignments
            where ticket_id = ticket.id and status = 'claimed'
            order by claimed_at desc limit 1
         ) assigned on true
        where ticket.event_slug = $1 and ticket.status in ('valid','void')
          and coalesce(accepted.recipient_email,assigned.recipient_email,ticket.email) is not null`,
      [input.eventSlug],
    ),
  ]);
  const event = eventRows[0];
  if (!event || event.status !== "cancelled")
    throw new Error("The event must be cancelled before its cancellation workflow runs");

  await transaction(async (client) => {
    const assignments = await client.query<{ action_link_id: string | null }>(
      `update ticket_assignments
          set status = 'cancelled',cancelled_at = now(),updated_at = now()
        where event_slug = $1 and status = 'pending'
        returning action_link_id`,
      [input.eventSlug],
    );
    const transfers = await client.query<{ action_link_id: string | null }>(
      `update ticket_transfers
          set status = 'invalidated',invalidated_at = now(),updated_at = now(),
              invalidation_reason = 'event-cancelled'
        where event_slug = $1 and status = 'pending'
        returning action_link_id`,
      [input.eventSlug],
    );
    const returns = await client.query<{ action_link_id: string | null }>(
      `update ticket_return_requests
          set status = 'cancelled',resolved_at = now(),updated_at = now(),
              resolution_reason = 'event-cancelled'
        where event_slug = $1 and status = 'awaiting-consent'
        returning action_link_id`,
      [input.eventSlug],
    );
    const linkIds = [...assignments.rows, ...transfers.rows, ...returns.rows]
      .map(({ action_link_id }) => action_link_id)
      .filter((id): id is string => Boolean(id));
    if (linkIds.length > 0) {
      await client.query(
        `update attendee_action_links
            set revoked_at = coalesce(revoked_at, now()),
                revoke_reason = coalesce(revoke_reason, 'event-cancelled')
          where id = any($1::text[]) and consumed_at is null`,
        [linkIds],
      );
    }
  });

  let refundedOrders = 0;
  let failedOrders = 0;
  for (const order of orders) {
    const result = await refundOrder({ ticketId: order.ticket_id, reason: "admin" });
    if (result.ok) refundedOrders += 1;
    else {
      failedOrders += 1;
      await emitDomainEvent({
        kind: "event.cancellation_refund_failed",
        deduplicationKey: `event-cancellation:${input.eventSlug}:order:${order.order_id}:refund-failed`,
        actorType: "system",
        actorId: input.actorId,
        eventSlug: input.eventSlug,
        entityRefs: { orderId: order.order_id, ticketId: order.ticket_id },
        severity: "critical",
        admin: {
          title: "Cancellation refund failed",
          body: `Order ${order.order_id} could not be refunded automatically and needs manual review.`,
          deepLink: `/admin?view=operations&event=${encodeURIComponent(input.eventSlug)}`,
          category: "event-cancellation-refund-failed",
          createCase: true,
        },
      });
    }
  }

  const voidedComplimentaryTickets = await transaction(async (client) => {
    const voided = await client.query<{ id: string }>(
      `update tickets set status = 'void'
        where event_slug = $1 and payment_ref is null and status = 'valid'
        returning id`,
      [input.eventSlug],
    );
    if (voided.rows.length) {
      await client.query(
        `update event_participants set status = 'void',updated_at = now()
          where ticket_id = any($1::text[]) and status = 'active'`,
        [voided.rows.map((row) => row.id)],
      );
    }
    return voided.rows.length;
  });

  let holderEmailsQueued = 0;
  if (appOrigin) {
    const eventUrl = buildAppUrl(appOrigin, `/events/${encodeURIComponent(input.eventSlug)}`);
    for (const email of new Set(holders.map((holder) => holder.email))) {
      const delivery = await sendEmail(
        {
          channel: "communications",
          to: email,
          subject: `${event.title} has been cancelled`,
          text: `${event.title} has been cancelled.\n\n${input.reason.trim()}\n\nPaid tickets are returned only to the purchaser's original payment method. See the event page for the latest information: ${eventUrl}\n\n— milk & henny`,
          html: renderBrandedEmail({
            origin: appOrigin,
            label: "event update",
            title: `${event.title} has been cancelled`,
            contentHtml: `<p style="margin:0">${escapeEmailHtml(input.reason.trim())}</p><p style="margin:18px 0 0">Paid tickets are returned only to the purchaser’s original payment method.</p>`,
            action: { label: "view event update", url: eventUrl },
          }),
        },
        {
          idempotencyKey: `event-cancelled:${input.eventSlug}:holder:${createHash("sha256").update(email).digest("hex")}`,
          kind: "event-broadcast",
          source: "admin",
          context: { eventSlug: input.eventSlug },
        },
      );
      if (delivery.ok) holderEmailsQueued += 1;
    }
  }

  await query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,
        reason,affected_count,correlation_id)
     values ('event.cancellation.completed',$1,$2,$3,'event',$3,
             '{"status":"not-cancelled"}'::jsonb,$4::jsonb,$5,$6,$7)`,
    [
      input.actorType,
      input.actorId,
      input.eventSlug,
      JSON.stringify({
        status: "cancelled",
        refundedOrders,
        failedOrders,
        voidedComplimentaryTickets,
        holderEmailsQueued,
      }),
      input.reason.trim(),
      holders.length,
      randomUUID(),
    ],
  );
  await emitDomainEvent({
    kind: "event.cancelled",
    deduplicationKey: `event:${input.eventSlug}:cancelled`,
    actorType: input.actorType,
    actorId: input.actorId,
    eventSlug: input.eventSlug,
    entityRefs: { eventSlug: input.eventSlug },
    payload: { refundedOrders, failedOrders, holderEmailsQueued },
  });
  return {
    orders: orders.length,
    refundedOrders,
    failedOrders,
    voidedComplimentaryTickets,
    holderEmailsQueued,
  };
}
