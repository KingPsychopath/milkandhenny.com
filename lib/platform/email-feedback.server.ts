import { createHash } from "node:crypto";
import { Webhook } from "svix";

import { log } from "./logger.server";
import { isDatabaseConfigured, transaction } from "./postgres.server";

const HANDLED_EVENTS = new Set(["email.bounced", "email.complained", "email.suppressed"] as const);

type FeedbackType = "email.bounced" | "email.complained" | "email.suppressed";

export type EmailFeedbackEvent = {
  eventId: string;
  type: FeedbackType;
  occurredAt: Date;
  providerMessageId: string;
  recipients: string[];
};

function hashRecipient(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseVerifiedEvent(value: unknown, eventId: string): EmailFeedbackEvent | null {
  const event = asRecord(value);
  const type = event?.type;
  if (typeof type !== "string" || !HANDLED_EVENTS.has(type as FeedbackType)) return null;

  const data = asRecord(event?.data);
  const occurredAt = typeof event?.created_at === "string" ? new Date(event.created_at) : null;
  const recipients = Array.isArray(data?.to)
    ? data.to.filter((recipient): recipient is string => typeof recipient === "string")
    : [];
  if (
    !occurredAt ||
    Number.isNaN(occurredAt.valueOf()) ||
    typeof data?.email_id !== "string" ||
    recipients.length === 0
  ) {
    throw new Error("Email feedback payload is invalid");
  }

  return {
    eventId,
    type: type as FeedbackType,
    occurredAt,
    providerMessageId: data.email_id,
    recipients,
  };
}

export function verifyResendFeedback(
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
): EmailFeedbackEvent | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Resend webhook signing secret is not configured");
  const verified = new Webhook(secret).verify(payload, {
    "svix-id": headers.id,
    "svix-timestamp": headers.timestamp,
    "svix-signature": headers.signature,
  });
  return parseVerifiedEvent(verified, headers.id);
}

function suppressionReason(type: FeedbackType): string {
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "complained";
  return "provider_suppressed";
}

export async function recordEmailFeedback(event: EmailFeedbackEvent): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("Email feedback database is unavailable");

  await transaction(async (client) => {
    for (const recipient of event.recipients) {
      const recipientHash = hashRecipient(recipient);
      const inserted = await client.query(
        `insert into email_feedback_events (
           event_id, event_type, provider_message_id, recipient_hash, occurred_at
         ) values ($1,$2,$3,$4,$5)
         on conflict (event_id, recipient_hash) do nothing`,
        [event.eventId, event.type, event.providerMessageId, recipientHash, event.occurredAt],
      );
      if (inserted.rowCount === 0) continue;

      await client.query(
        `insert into email_suppressions (
           recipient_hash, reason, provider_message_id, first_occurred_at, last_occurred_at
         ) values ($1,$2,$3,$4,$4)
         on conflict (recipient_hash) do update
           set reason = excluded.reason,
               provider_message_id = excluded.provider_message_id,
               last_occurred_at = greatest(
                 email_suppressions.last_occurred_at,
                 excluded.last_occurred_at
               ),
               updated_at = now()`,
        [recipientHash, suppressionReason(event.type), event.providerMessageId, event.occurredAt],
      );
    }

    await client.query(
      `update email_outbox
          set status = 'failed', provider_status = 422,
              last_error = $2, failed_at = $3, updated_at = now()
        where provider_message_id = $1 and status = 'accepted'`,
      [event.providerMessageId, `Provider reported ${event.type}`, event.occurredAt],
    );
  });

  log.warn("email.feedback", "Email recipient suppressed", {
    eventId: event.eventId,
    type: event.type,
    providerMessageId: event.providerMessageId,
    recipients: event.recipients.length,
  });
}

export const __emailFeedbackTesting = { hashRecipient, parseVerifiedEvent };
