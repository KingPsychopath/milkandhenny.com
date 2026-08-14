import { createHash, timingSafeEqual } from "node:crypto";

import { log } from "./logger.server";
import { isDatabaseConfigured, transaction } from "./postgres.server";

const HANDLED_EVENTS = new Set([
  "cf.email.sending.message.bounced",
  "cf.email.sending.message.complained",
] as const);

type FeedbackType = "cf.email.sending.message.bounced" | "cf.email.sending.message.complained";

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

export function authenticateCloudflareEmailRelay(request: Request): boolean {
  const secret = process.env.EMAIL_EVENT_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length).trim();
  const expectedDigest = createHash("sha256").update(secret).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export function parseCloudflareEmailFeedback(
  value: unknown,
  eventId: string,
  occurredAt: Date,
): EmailFeedbackEvent | null {
  const event = asRecord(value);
  const type = event?.type;
  if (typeof type !== "string" || !HANDLED_EVENTS.has(type as FeedbackType)) return null;

  const source = asRecord(event?.source);
  const payload = asRecord(event?.payload);
  if (
    !eventId ||
    source?.type !== "email.sending" ||
    !Number.isFinite(occurredAt.valueOf()) ||
    typeof payload?.messageId !== "string" ||
    typeof payload?.recipient !== "string"
  ) {
    throw new Error("Cloudflare email feedback payload is invalid");
  }

  return {
    eventId,
    type: type as FeedbackType,
    occurredAt,
    providerMessageId: payload.messageId,
    recipients: [payload.recipient],
  };
}

function suppressionReason(type: FeedbackType): string {
  return type === "cf.email.sending.message.bounced" ? "bounced" : "complained";
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
      [event.providerMessageId, `Cloudflare reported ${event.type}`, event.occurredAt],
    );
  });

  log.warn("email.feedback", "Cloudflare email recipient suppressed", {
    eventId: event.eventId,
    type: event.type,
    providerMessageId: event.providerMessageId,
    recipients: event.recipients.length,
  });
}

export const __emailFeedbackTesting = { hashRecipient };
