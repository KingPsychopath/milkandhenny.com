import { createHash, timingSafeEqual } from "node:crypto";

import { type EmailDeliveryEvent, type EmailDeliveryStatus } from "../email-delivery-events.server";

type CloudflareEmailDeliveryEventType =
  | "cf.email.sending.message.delivered"
  | "cf.email.sending.message.deferred"
  | "cf.email.sending.message.bounced"
  | "cf.email.sending.message.failed"
  | "cf.email.sending.message.rejected"
  | "cf.email.sending.message.complained";

const CLOUDFLARE_EVENT_STATUS: Readonly<
  Record<CloudflareEmailDeliveryEventType, EmailDeliveryStatus>
> = {
  "cf.email.sending.message.delivered": "delivered",
  "cf.email.sending.message.deferred": "deferred",
  "cf.email.sending.message.bounced": "bounced",
  "cf.email.sending.message.failed": "failed",
  "cf.email.sending.message.rejected": "rejected",
  "cf.email.sending.message.complained": "complained",
};

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

/** Translate Cloudflare's event names into the app's provider-neutral model. */
export function parseCloudflareEmailDeliveryEvent(
  value: unknown,
  eventId: string,
  occurredAt: Date,
): EmailDeliveryEvent | null {
  const event = asRecord(value);
  const type = event?.type;
  const status =
    typeof type === "string"
      ? CLOUDFLARE_EVENT_STATUS[type as CloudflareEmailDeliveryEventType]
      : undefined;
  if (!status) return null;

  const source = asRecord(event?.source);
  const payload = asRecord(event?.payload);
  const bounce = asRecord(payload?.bounce);
  if (
    !eventId ||
    source?.type !== "email.sending" ||
    !Number.isFinite(occurredAt.valueOf()) ||
    typeof payload?.messageId !== "string" ||
    typeof payload?.recipient !== "string"
  ) {
    throw new Error("Cloudflare email delivery payload is invalid");
  }

  return {
    eventId,
    type: status,
    occurredAt,
    providerMessageId: payload.messageId,
    recipients: [payload.recipient],
    suppressRecipient: status === "complained" || (status === "bounced" && bounce?.type === "hard"),
  };
}
