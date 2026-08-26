export const EMAIL_CHANNELS = [
  "tickets",
  "studio",
  "communications",
  "access",
  "operations",
] as const;
export type EmailChannel = (typeof EMAIL_CHANNELS)[number];

export const EMAIL_OUTBOX_STATUSES = [
  "pending",
  "processing",
  "accepted",
  "failed",
  "cancelled",
] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

export const EMAIL_DELIVERY_STATUSES = [
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "rejected",
  "complained",
] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_KINDS = [
  "ticket-issued",
  "ticket-resend",
  "ticket-refund",
  "ticket-exchange",
  "ticket-exchange-payment",
  "attendee-access",
  "ticket-assignment",
  "ticket-transfer",
  "ticket-return",
  "staff-access",
  "admin-access",
  "security-notice",
  "operations-alert",
  "operations-digest",
  "event-broadcast",
  "communication",
  "communication-stage",
  "communication-test",
  "pitch-welcome",
  "pitch-published",
  "pitch-recovery",
  "pitch-reminder",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_SOURCES = ["system", "admin", "self-service", "scheduled", "test"] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];

/** Non-secret references that let operators find and, where safe, regenerate a message. */
export interface EmailContext {
  eventSlug?: string;
  orderId?: string;
  ticketId?: string;
  ticketIds?: string[];
  exchangeId?: string;
  deckId?: string;
  communicationId?: string;
  replayedFrom?: string;
  assignmentId?: string;
  transferId?: string;
  returnRequestId?: string;
  staffAssignmentId?: string;
  adminGrantId?: string;
  caseId?: string;
}

export const EMAIL_QUEUE_CONTENT_DAYS = 7;
export const EMAIL_LEDGER_RETENTION_DAYS = 120;
export const EMAIL_DELIVERY_EVENT_RETENTION_DAYS = 30;
export const EMAIL_MAX_DELIVERY_ATTEMPTS = 10;

export function isEmailChannel(value: unknown): value is EmailChannel {
  return EMAIL_CHANNELS.some((channel) => channel === value);
}

export function isEmailOutboxStatus(value: unknown): value is EmailOutboxStatus {
  return EMAIL_OUTBOX_STATUSES.some((status) => status === value);
}

export function isEmailDeliveryStatus(value: unknown): value is EmailDeliveryStatus {
  return EMAIL_DELIVERY_STATUSES.some((status) => status === value);
}

export function isEmailKind(value: unknown): value is EmailKind {
  return EMAIL_KINDS.some((kind) => kind === value);
}

export function isEmailSource(value: unknown): value is EmailSource {
  return EMAIL_SOURCES.some((source) => source === value);
}
