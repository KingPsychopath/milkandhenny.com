import { createHash } from "node:crypto";

import { log } from "./logger.server";
import { isDatabaseConfigured, transaction } from "./postgres.server";
import { maskEmailRecipient } from "./email-outbox.server";

export type EmailDeliveryStatus =
  | "delivered"
  | "deferred"
  | "bounced"
  | "failed"
  | "rejected"
  | "complained";

export type EmailDeliveryEvent = {
  eventId: string;
  type: EmailDeliveryStatus;
  occurredAt: Date;
  providerMessageId: string;
  recipients: string[];
};

function hashRecipient(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function suppressesFutureDelivery(type: EmailDeliveryStatus): boolean {
  return type === "bounced" || type === "complained";
}

function isPermanentDeliveryFailure(type: EmailDeliveryStatus): boolean {
  return type === "bounced" || type === "failed" || type === "rejected" || type === "complained";
}

/** Persist normalized delivery state without coupling the product to a sender. */
export async function recordEmailDeliveryEvent(event: EmailDeliveryEvent): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("Email delivery events database is unavailable");

  await transaction(async (client) => {
    let insertedRecipients = 0;
    for (const recipient of event.recipients) {
      const recipientHash = hashRecipient(recipient);
      const inserted = await client.query(
        `insert into email_delivery_events (
           event_id, event_type, provider_message_id, recipient_hash, occurred_at
         ) values ($1,$2,$3,$4,$5)
         on conflict (event_id, recipient_hash) do nothing`,
        [event.eventId, event.type, event.providerMessageId, recipientHash, event.occurredAt],
      );
      if (inserted.rowCount === 0) continue;
      insertedRecipients += 1;

      if (suppressesFutureDelivery(event.type)) {
        await client.query(
          `insert into email_suppressions (
             recipient_hash, recipient_hint, reason, provider_message_id,
             first_occurred_at, last_occurred_at
           ) values ($1,$2,$3,$4,$5,$5)
           on conflict (recipient_hash) do update
             set recipient_hint = excluded.recipient_hint,
                 reason = excluded.reason,
                 provider_message_id = excluded.provider_message_id,
                 last_occurred_at = greatest(
                   email_suppressions.last_occurred_at,
                   excluded.last_occurred_at
                 ),
                 updated_at = now()`,
          [
            recipientHash,
            maskEmailRecipient(recipient),
            event.type === "complained" ? "complained" : "bounced",
            event.providerMessageId,
            event.occurredAt,
          ],
        );
      }
    }

    if (insertedRecipients === 0) return;

    if (isPermanentDeliveryFailure(event.type)) {
      await client.query(
        `update email_outbox
            set status = 'failed',
                provider_delivery_status = $2,
                provider_status = 422,
                last_error = $3,
                failed_at = $4,
                updated_at = now()
          where provider_message_id = $1 and status in ('accepted', 'failed')`,
        [
          event.providerMessageId,
          event.type,
          `Email provider reported ${event.type}`,
          event.occurredAt,
        ],
      );
    } else {
      await client.query(
        `update email_outbox
            set provider_delivery_status = $2,
                delivered_at = case when $2 = 'delivered' then $3 else delivered_at end,
                last_error = case when $2 = 'deferred' then $4 else last_error end,
                updated_at = now()
          where provider_message_id = $1`,
        [
          event.providerMessageId,
          event.type,
          event.occurredAt,
          `Email provider reported ${event.type}`,
        ],
      );
    }

    await client.query(
      `update communication_stage_deliveries
          set status = $2, updated_at = now()
        where outbox_id in (
          select id from email_outbox where provider_message_id = $1
        )`,
      [event.providerMessageId, event.type],
    );
  });

  log.info("email.delivery", "Recorded provider delivery event", {
    eventId: event.eventId,
    type: event.type,
    providerMessageId: event.providerMessageId,
    recipients: event.recipients.length,
  });
}

export const __emailDeliveryTesting = { hashRecipient };
