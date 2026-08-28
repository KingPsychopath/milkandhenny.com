import type {
  EmailChannel,
  EmailContext,
  EmailDeliveryStatus,
  EmailKind,
  EmailOutboxStatus,
  EmailSource,
} from "@/lib/shared/email-operations";

export type EmailLedgerSort = "newest" | "oldest" | "next-attempt";
export type EmailFeedbackHealth = "disabled" | "waiting" | "healthy" | "stale";

export interface EmailLedgerQuery {
  page: number;
  limit: number;
  sort: EmailLedgerSort;
  query?: string;
  channel?: EmailChannel;
  status?: EmailOutboxStatus;
  deliveryStatus?: EmailDeliveryStatus;
  kind?: EmailKind;
  source?: EmailSource;
  eventSlug?: string;
}

export interface EmailLedgerEntry {
  id: string;
  idempotencyKey: string;
  channel: EmailChannel;
  kind: EmailKind;
  source: EmailSource;
  context: EmailContext;
  recipientHint: string | null;
  suppression: EmailSuppression | null;
  subject: string | null;
  status: EmailOutboxStatus;
  deliveryStatus: EmailDeliveryStatus | null;
  attempts: number;
  providerStatus: number | null;
  providerMessageId: string | null;
  lastError: string | null;
  payloadRetained: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canResend: boolean;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  contentExpiresAt: string;
  retainUntil: string;
}

export interface EmailSuppression {
  recipientHash: string;
  recipientHint: string | null;
  reason: "bounced" | "complained";
  firstOccurredAt: string;
  lastOccurredAt: string;
}

export interface EmailOperationsOverview {
  available: boolean;
  counts: Record<EmailOutboxStatus, number>;
  delivered: number;
  awaitingProviderFeedback: number;
  latestAcceptedAt: string | null;
  latestDeliveryEventAt: string | null;
  feedbackHealth: EmailFeedbackHealth;
  deliveryEventsConfigured: boolean;
  suppressions: EmailSuppression[];
  suppressionCount: number;
  policy: {
    queueContentDays: number;
    ledgerDays: number;
    deliveryEventDays: number;
    maxAttempts: number;
  };
}

export interface EmailLedgerPage {
  entries: EmailLedgerEntry[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  overview: EmailOperationsOverview;
}

export interface EmailCleanupResult {
  expiredMessages: number;
  deletedLedgerEntries: number;
  deletedDeliveryEvents: number;
}
