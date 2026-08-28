import { emitDomainEvent } from "@/features/attendee-operations/notifications.server";
import {
  type EmailDeliveryEvent,
  recordEmailDeliveryEvent,
} from "@/lib/platform/email-delivery-events.server";
import { hashEmailRecipient } from "@/lib/platform/email-outbox.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import type { EmailContext } from "@/lib/shared/email-operations";

type DeliveryRecord = {
  id: string;
  kind: string;
  context: EmailContext;
  recipient_hint: string | null;
  subject_hint: string | null;
  first_occurred_at: Date | null;
  event_slug: string | null;
  is_current?: boolean;
};

function createsAttention(type: EmailDeliveryEvent["type"]): boolean {
  return type === "bounced" || type === "failed" || type === "rejected" || type === "complained";
}

function outcomeLabel(type: EmailDeliveryEvent["type"]): string {
  if (type === "complained") return "complaint";
  if (type === "rejected") return "provider rejection";
  if (type === "failed") return "delivery failure";
  return "bounce";
}

async function createDeliveryAttention(
  record: DeliveryRecord,
  type: EmailDeliveryEvent["type"],
  recipientHash: string,
  deduplicationSuffix: string,
): Promise<void> {
  const context = record.context ?? {};
  const isTicket = record.kind.startsWith("ticket-");
  await emitDomainEvent({
    kind: `email.delivery_${type}`,
    deduplicationKey: `email-delivery:${recipientHash}:${deduplicationSuffix}`,
    actorType: "system",
    eventSlug: record.event_slug ?? undefined,
    entityRefs: {
      recipientHash,
      outboxId: record.id,
      orderId: context.orderId,
      ticketId: context.ticketId,
      eventSlug: context.eventSlug,
    },
    severity: "warning",
    admin: {
      title: `${isTicket ? "Ticket email" : "Email"} ${type}`,
      body: `${record.recipient_hint ?? "A recipient"} reported a ${outcomeLabel(type)}${record.subject_hint ? ` for “${record.subject_hint}”` : ""}. Correct the address or review the block before sending again.`,
      category: "email-delivery",
      createCase: true,
    },
  });
}

/** Fold provider feedback into the outbox and project durable operator work. */
export async function recordEmailDeliveryFeedback(event: EmailDeliveryEvent): Promise<void> {
  await recordEmailDeliveryEvent(event);
  if (!createsAttention(event.type)) return;

  for (const recipient of event.recipients) {
    const recipientHash = hashEmailRecipient(recipient);
    const records = await query<DeliveryRecord>(
      `select outbox.id,outbox.kind,outbox.context,outbox.recipient_hint,outbox.subject_hint,
              suppression.first_occurred_at,event.slug as event_slug,
              not exists (
                select 1
                  from email_delivery_events newer
                 where newer.provider_message_id = $1
                   and newer.recipient_hash = $2
                   and newer.occurred_at > $3
              ) as is_current
         from email_outbox outbox
         left join email_suppressions suppression
           on suppression.recipient_hash = outbox.recipient_hash
         left join events event on event.slug = outbox.context->>'eventSlug'
        where outbox.provider_message_id = $1
          and outbox.recipient_hash = $2
        order by outbox.created_at desc
        limit 1`,
      [event.providerMessageId, recipientHash, event.occurredAt],
    );
    const record = records[0];
    if (!record?.is_current) continue;
    await createDeliveryAttention(
      record,
      event.type,
      recipientHash,
      record.first_occurred_at?.toISOString() ?? event.eventId,
    );
  }
}

/** Repair attention projections for immediate provider bounces even if feedback is delayed. */
export async function reconcileEmailDeliveryAttention(): Promise<number> {
  const records = await query<
    DeliveryRecord & { recipient_hash: string; suppression_reason: "bounced" | "complained" }
  >(
    `select suppression.recipient_hash,suppression.reason as suppression_reason,
            suppression.first_occurred_at,
            outbox.id,outbox.kind,outbox.context,outbox.recipient_hint,outbox.subject_hint,
            event.slug as event_slug
       from email_suppressions suppression
       join lateral (
         select candidate.id,candidate.kind,candidate.context,candidate.recipient_hint,
                candidate.subject_hint
           from email_outbox candidate
          where candidate.recipient_hash = suppression.recipient_hash
          order by candidate.created_at desc,candidate.id desc
          limit 1
       ) outbox on true
       left join events event on event.slug = outbox.context->>'eventSlug'`,
  );
  for (const record of records) {
    await createDeliveryAttention(
      record,
      record.suppression_reason,
      record.recipient_hash,
      record.first_occurred_at?.toISOString() ?? record.id,
    );
  }
  return records.length;
}

/** Remove a suppression and close its operator case as one durable state change. */
export async function resolveEmailDeliveryBlock(
  recipientHash: string,
  reason: string,
): Promise<boolean> {
  return transaction(async (client) => {
    const suppression = await client.query<{ recipient_hash: string }>(
      `delete from email_suppressions where recipient_hash = $1 returning recipient_hash`,
      [recipientHash],
    );
    if (!suppression.rows[0]) return false;

    const rows = await client.query<{ id: string; case_id: string | null }>(
      `update admin_notifications notification
          set status = 'resolved',updated_at = now(),resolved_at = now()
         from attendee_domain_events domain
        where notification.source_event_id = domain.id
          and notification.category = 'email-delivery'
          and notification.status in ('new','in-progress')
          and domain.entity_refs->>'recipientHash' = $1
        returning notification.id,notification.case_id`,
      [recipientHash],
    );
    const caseIds = rows.rows.flatMap((row) => (row.case_id ? [row.case_id] : []));
    if (caseIds.length > 0) {
      await client.query(
        `update admin_attention_cases
            set status = 'resolved',resolution_reason = $2,updated_at = now(),resolved_at = now()
          where id = any($1::text[])`,
        [caseIds, reason],
      );
    }
    for (const row of rows.rows) {
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason)
         values ('notification.auto-resolved','system','email-delivery','notification',$1,
                 '{"status":"new-or-in-progress"}'::jsonb,'{"status":"resolved"}'::jsonb,$2)`,
        [row.id, reason],
      );
    }
    return true;
  });
}
