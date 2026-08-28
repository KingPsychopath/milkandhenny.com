import { randomUUID } from "node:crypto";

import { resolveEmailDeliveryBlock } from "./delivery-feedback.server";
import { getEvent } from "@/features/events/store.server";
import { sendRefundEmail, sendTicketEmail } from "@/features/tickets/email.server";
import { listTicketsForOrder, updateTicketOrderEmail } from "@/features/tickets/store.server";
import { assessEmailAddress, normaliseEmail } from "@/lib/shared/email-address";
import { drainEmailOutbox, hashEmailRecipient } from "@/lib/platform/email-outbox.server";
import { describeEmailCapability } from "@/lib/platform/email.server";
import { isDatabaseConfigured, query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  EMAIL_DELIVERY_EVENT_RETENTION_DAYS,
  EMAIL_LEDGER_RETENTION_DAYS,
  EMAIL_MAX_DELIVERY_ATTEMPTS,
  EMAIL_QUEUE_CONTENT_DAYS,
  isEmailChannel,
  isEmailDeliveryStatus,
  isEmailKind,
  isEmailOutboxStatus,
  isEmailSource,
  type EmailContext,
} from "@/lib/shared/email-operations";
import type {
  EmailCleanupResult,
  EmailFeedbackHealth,
  EmailLedgerEntry,
  EmailLedgerPage,
  EmailLedgerQuery,
  EmailOperationsOverview,
  EmailSuppression,
} from "./types";

const FEEDBACK_GRACE_MINUTES = 15;
const RESENDABLE_KINDS = new Set(["ticket-issued", "ticket-resend", "ticket-refund"]);

export interface EmailResendResult {
  queued: boolean;
  alreadyRequested: boolean;
}

interface LedgerRow {
  id: string;
  idempotency_key: string;
  channel: string;
  kind: string;
  source: string;
  context: unknown;
  recipient_hint: string | null;
  suppression_reason: string | null;
  suppression_first_occurred_at: Date | null;
  suppression_last_occurred_at: Date | null;
  suppression_recipient_hash: string | null;
  subject_hint: string | null;
  status: string;
  provider_delivery_status: string | null;
  attempts: number;
  provider_status: number | null;
  provider_message_id: string | null;
  last_error: string | null;
  payload_retained: boolean;
  next_attempt_at: Date;
  created_at: Date;
  updated_at: Date;
  accepted_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  cancelled_at: Date | null;
  content_expires_at: Date;
  retain_until: Date;
}

interface SuppressionRow {
  recipient_hash: string;
  recipient_hint: string | null;
  reason: string;
  first_occurred_at: Date;
  last_occurred_at: Date;
}

interface OverviewRow {
  pending: string;
  processing: string;
  accepted: string;
  failed: string;
  cancelled: string;
  delivered: string;
  awaiting_feedback: string;
  latest_accepted_at: Date | null;
  latest_delivery_event_at: Date | null;
  suppression_count: string;
}

export class EmailOperationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EmailOperationError";
  }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function parseContext(value: unknown): EmailContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const context: EmailContext = {};
  for (const key of [
    "eventSlug",
    "orderId",
    "ticketId",
    "exchangeId",
    "deckId",
    "communicationId",
    "replayedFrom",
  ] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) context[key] = value.trim();
  }
  if (Array.isArray(source.ticketIds)) {
    const ticketIds = source.ticketIds
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (ticketIds.length > 0) context.ticketIds = [...new Set(ticketIds)];
  }
  return context;
}

function entryFromRow(row: LedgerRow): EmailLedgerEntry {
  if (
    !isEmailChannel(row.channel) ||
    !isEmailKind(row.kind) ||
    !isEmailSource(row.source) ||
    !isEmailOutboxStatus(row.status) ||
    (row.provider_delivery_status !== null && !isEmailDeliveryStatus(row.provider_delivery_status))
  ) {
    throw new Error(`Email ledger row ${row.id} has an invalid state`);
  }
  const context = parseContext(row.context);
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    channel: row.channel,
    kind: row.kind,
    source: row.source,
    context,
    recipientHint: row.recipient_hint,
    suppression:
      (row.suppression_reason === "bounced" || row.suppression_reason === "complained") &&
      row.suppression_recipient_hash &&
      row.suppression_first_occurred_at &&
      row.suppression_last_occurred_at
        ? {
            recipientHash: row.suppression_recipient_hash,
            recipientHint: row.recipient_hint,
            reason: row.suppression_reason,
            firstOccurredAt: row.suppression_first_occurred_at.toISOString(),
            lastOccurredAt: row.suppression_last_occurred_at.toISOString(),
          }
        : null,
    subject: row.subject_hint,
    status: row.status,
    deliveryStatus: row.provider_delivery_status,
    attempts: Number(row.attempts),
    providerStatus: row.provider_status,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    payloadRetained: row.payload_retained,
    canRetry: row.status === "pending",
    canCancel: row.status === "pending",
    canResend:
      ["accepted", "failed", "cancelled"].includes(row.status) &&
      RESENDABLE_KINDS.has(row.kind) &&
      typeof context.orderId === "string" &&
      (row.kind !== "ticket-refund" || Boolean(context.ticketIds?.length)),
    nextAttemptAt: row.next_attempt_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    acceptedAt: iso(row.accepted_at),
    deliveredAt: iso(row.delivered_at),
    failedAt: iso(row.failed_at),
    cancelledAt: iso(row.cancelled_at),
    contentExpiresAt: row.content_expires_at.toISOString(),
    retainUntil: row.retain_until.toISOString(),
  };
}

function feedbackHealth(input: {
  configured: boolean;
  awaiting: number;
  latestEventAt: Date | null;
}): EmailFeedbackHealth {
  if (!input.configured) return "disabled";
  if (input.latestEventAt) return input.awaiting > 0 ? "stale" : "healthy";
  return input.awaiting > 0 ? "stale" : "waiting";
}

async function readOverview(): Promise<EmailOperationsOverview> {
  const emptyCounts = { pending: 0, processing: 0, accepted: 0, failed: 0, cancelled: 0 };
  const capability = describeEmailCapability();
  if (!isDatabaseConfigured()) {
    return {
      available: false,
      counts: emptyCounts,
      delivered: 0,
      awaitingProviderFeedback: 0,
      latestAcceptedAt: null,
      latestDeliveryEventAt: null,
      feedbackHealth: capability.deliveryEventsConfigured ? "waiting" : "disabled",
      deliveryEventsConfigured: capability.deliveryEventsConfigured,
      suppressions: [],
      suppressionCount: 0,
      policy: {
        queueContentDays: EMAIL_QUEUE_CONTENT_DAYS,
        ledgerDays: EMAIL_LEDGER_RETENTION_DAYS,
        deliveryEventDays: EMAIL_DELIVERY_EVENT_RETENTION_DAYS,
        maxAttempts: EMAIL_MAX_DELIVERY_ATTEMPTS,
      },
    };
  }

  const [overview, suppressionRows] = await Promise.all([
    queryOne<OverviewRow>(
      `select
         count(*) filter (where status = 'pending')::text as pending,
         count(*) filter (where status = 'processing')::text as processing,
         count(*) filter (where status = 'accepted')::text as accepted,
         count(*) filter (where status = 'failed')::text as failed,
         count(*) filter (where status = 'cancelled')::text as cancelled,
         count(*) filter (where provider_delivery_status = 'delivered')::text as delivered,
         count(*) filter (
           where status = 'accepted'
             and provider_delivery_status is null
             and accepted_at < now() - ($1 * interval '1 minute')
         )::text as awaiting_feedback,
         max(accepted_at) as latest_accepted_at,
         (select max(received_at) from email_delivery_events) as latest_delivery_event_at,
         (select count(*)::text from email_suppressions) as suppression_count
       from email_outbox`,
      [FEEDBACK_GRACE_MINUTES],
    ),
    query<SuppressionRow>(
      `select recipient_hash, recipient_hint, reason, first_occurred_at, last_occurred_at
         from email_suppressions
        order by last_occurred_at desc, recipient_hash
        limit 50`,
    ),
  ]);

  const awaiting = Number(overview?.awaiting_feedback ?? 0);
  const latestEventAt = overview?.latest_delivery_event_at ?? null;
  const suppressions: EmailSuppression[] = suppressionRows.flatMap((row) =>
    row.reason === "bounced" || row.reason === "complained"
      ? [
          {
            recipientHash: row.recipient_hash,
            recipientHint: row.recipient_hint,
            reason: row.reason,
            firstOccurredAt: row.first_occurred_at.toISOString(),
            lastOccurredAt: row.last_occurred_at.toISOString(),
          },
        ]
      : [],
  );
  return {
    available: true,
    counts: {
      pending: Number(overview?.pending ?? 0),
      processing: Number(overview?.processing ?? 0),
      accepted: Number(overview?.accepted ?? 0),
      failed: Number(overview?.failed ?? 0),
      cancelled: Number(overview?.cancelled ?? 0),
    },
    delivered: Number(overview?.delivered ?? 0),
    awaitingProviderFeedback: awaiting,
    latestAcceptedAt: iso(overview?.latest_accepted_at ?? null),
    latestDeliveryEventAt: iso(latestEventAt),
    feedbackHealth: feedbackHealth({
      configured: capability.deliveryEventsConfigured,
      awaiting,
      latestEventAt,
    }),
    deliveryEventsConfigured: capability.deliveryEventsConfigured,
    suppressions,
    suppressionCount: Number(overview?.suppression_count ?? 0),
    policy: {
      queueContentDays: EMAIL_QUEUE_CONTENT_DAYS,
      ledgerDays: EMAIL_LEDGER_RETENTION_DAYS,
      deliveryEventDays: EMAIL_DELIVERY_EVENT_RETENTION_DAYS,
      maxAttempts: EMAIL_MAX_DELIVERY_ATTEMPTS,
    },
  };
}

export async function listEmailLedger(input: EmailLedgerQuery): Promise<EmailLedgerPage> {
  if (!isDatabaseConfigured()) {
    return {
      entries: [],
      page: 1,
      limit: input.limit,
      total: 0,
      pages: 0,
      overview: await readOverview(),
    };
  }
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (input.channel) add("channel = ?", input.channel);
  if (input.status) add("status = ?", input.status);
  if (input.deliveryStatus) add("provider_delivery_status = ?", input.deliveryStatus);
  if (input.kind) add("kind = ?", input.kind);
  if (input.source) add("source = ?", input.source);
  if (input.eventSlug) add("context->>'eventSlug' = ?", input.eventSlug);
  if (input.query) {
    const term = input.query.trim();
    values.push(`%${term}%`);
    const textIndex = values.length;
    const exactEmail = term.includes("@") ? hashEmailRecipient(term) : null;
    if (exactEmail) {
      values.push(exactEmail);
      clauses.push(
        `(recipient_hash = $${values.length} or id::text ilike $${textIndex} or recipient_hint ilike $${textIndex} or subject_hint ilike $${textIndex} or idempotency_key ilike $${textIndex} or context::text ilike $${textIndex})`,
      );
    } else {
      clauses.push(
        `(id::text ilike $${textIndex} or recipient_hint ilike $${textIndex} or subject_hint ilike $${textIndex} or idempotency_key ilike $${textIndex} or context::text ilike $${textIndex})`,
      );
    }
  }
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const order =
    input.sort === "oldest"
      ? "created_at asc, id asc"
      : input.sort === "next-attempt"
        ? "next_attempt_at asc, created_at asc, id asc"
        : "created_at desc, id desc";
  values.push(input.limit);
  const limitIndex = values.length;
  values.push((input.page - 1) * input.limit);
  const offsetIndex = values.length;

  const [rows, countRow, overview] = await Promise.all([
    query<LedgerRow>(
      `select id, idempotency_key, channel, kind, source, context,
              recipient_hint, subject_hint, status, provider_delivery_status,
              (select reason from email_suppressions s where s.recipient_hash = email_outbox.recipient_hash)
                as suppression_reason,
              (select first_occurred_at from email_suppressions s where s.recipient_hash = email_outbox.recipient_hash)
                as suppression_first_occurred_at,
              (select last_occurred_at from email_suppressions s where s.recipient_hash = email_outbox.recipient_hash)
                as suppression_last_occurred_at,
              (select recipient_hash from email_suppressions s where s.recipient_hash = email_outbox.recipient_hash)
                as suppression_recipient_hash,
              attempts, provider_status, provider_message_id, last_error,
              message is not null as payload_retained,
              next_attempt_at, created_at, updated_at, accepted_at, delivered_at,
              failed_at, cancelled_at, content_expires_at, retain_until
         from email_outbox ${where}
        order by ${order}
        limit $${limitIndex} offset $${offsetIndex}`,
      values,
    ),
    queryOne<{ count: string }>(
      `select count(*)::text as count from email_outbox ${where}`,
      values.slice(0, limitIndex - 1),
    ),
    readOverview(),
  ]);
  const total = Number(countRow?.count ?? 0);
  return {
    entries: rows.map(entryFromRow),
    page: input.page,
    limit: input.limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / input.limit),
    overview,
  };
}

export async function retryEmailNow(id: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `update email_outbox
        set next_attempt_at = now(), last_error = null, updated_at = now()
      where id = $1 and status = 'pending' and message is not null
      returning id`,
    [id],
  );
  if (!row)
    throw new EmailOperationError(
      409,
      "Only a queued message with retained content can be retried",
    );
  await drainEmailOutbox();
}

export async function cancelQueuedEmail(id: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `update email_outbox
        set status = 'cancelled', message = null, cancelled_at = now(), updated_at = now()
      where id = $1 and status = 'pending'
      returning id`,
    [id],
  );
  if (!row)
    throw new EmailOperationError(
      409,
      "Only a message that has not started sending can be cancelled",
    );
  await query(
    `update communication_stage_deliveries
        set status = 'failed', updated_at = now()
      where outbox_id = $1 and status = 'queued'`,
    [id],
  );
}

export async function resendEmailFromLedger(
  id: string,
  origin: string,
): Promise<EmailResendResult> {
  const row = await queryOne<{ kind: string; context: unknown; status: string }>(
    `select kind, context, status from email_outbox where id = $1`,
    [id],
  );
  if (!row || !isEmailKind(row.kind))
    throw new EmailOperationError(404, "Email ledger entry not found");
  if (row.status === "pending" || row.status === "processing") {
    throw new EmailOperationError(
      409,
      "Retry or cancel the active queued message before resending",
    );
  }
  const context = parseContext(row.context);
  if (!context.orderId || !RESENDABLE_KINDS.has(row.kind)) {
    throw new EmailOperationError(
      409,
      "This message cannot be safely regenerated; use its owning ticket or communications tool",
    );
  }
  const tickets = await listTicketsForOrder(context.orderId);
  const first = tickets[0];
  if (!first) throw new EmailOperationError(404, "The order behind this email no longer exists");
  const event = await getEvent(first.eventSlug);
  if (!event) throw new EmailOperationError(404, "The event behind this email no longer exists");

  const nonce = randomUUID();
  if (row.kind === "ticket-refund") {
    const ticketIds = new Set(context.ticketIds ?? []);
    if (ticketIds.size === 0) {
      throw new EmailOperationError(
        409,
        "This older refund entry does not identify its exact ticket group; resend it from the order instead",
      );
    }
    const refunded = tickets.filter(
      (ticket) => ticket.status === "refunded" && ticketIds.has(ticket.id),
    );
    if (refunded.length !== ticketIds.size) {
      throw new EmailOperationError(
        409,
        "The original refunded ticket group is no longer available",
      );
    }
    const result = await sendRefundEmail({
      event,
      tickets: refunded,
      idempotencyKey: `tickets:refund-resend:${context.orderId}:${nonce}`,
      source: "admin",
      replayedFrom: id,
    });
    if (!result.queued)
      throw new EmailOperationError(502, result.error ?? "Refund email could not be queued");
    return { queued: true, alreadyRequested: result.alreadyRequested === true };
  }

  const live = tickets.filter((ticket) => ticket.status === "valid");
  if (live.length === 0)
    throw new EmailOperationError(409, "This order has no live tickets to send");
  const result = await sendTicketEmail({
    event,
    tickets: live,
    origin,
    idempotencyKey: `tickets:admin-resend:${context.orderId}:${nonce}`,
    kind: "ticket-resend",
    source: "admin",
    replayedFrom: id,
  });
  if (!result.queued)
    throw new EmailOperationError(502, result.error ?? "Ticket email could not be queued");
  return { queued: true, alreadyRequested: result.alreadyRequested === true };
}

export async function removeEmailSuppression(recipientHash: string): Promise<void> {
  const resolved = await resolveEmailDeliveryBlock(
    recipientHash,
    "Delivery block removed by an administrator",
  );
  if (!resolved) throw new EmailOperationError(404, "Suppression not found");
}

export async function correctTicketRecipientAndResend(
  id: string,
  recipientEmail: string | null,
  origin: string,
): Promise<EmailResendResult> {
  const row = await queryOne<{
    kind: string;
    context: unknown;
    status: string;
    provider_delivery_status: string | null;
    recipient_hash: string;
  }>(
    `select kind, context, status, provider_delivery_status, recipient_hash
       from email_outbox
      where id = $1`,
    [id],
  );
  if (!row || !isEmailKind(row.kind)) {
    throw new EmailOperationError(404, "Email ledger entry not found");
  }
  if (
    row.provider_delivery_status !== "bounced" ||
    (row.kind !== "ticket-issued" && row.kind !== "ticket-resend")
  ) {
    throw new EmailOperationError(409, "Only a bounced ticket email can use address recovery");
  }
  const context = parseContext(row.context);
  if (!context.orderId) {
    throw new EmailOperationError(409, "This email no longer identifies its ticket order");
  }
  const tickets = await listTicketsForOrder(context.orderId);
  const matchingTickets = tickets.filter(
    (ticket) => ticket.email && hashEmailRecipient(ticket.email) === row.recipient_hash,
  );
  const suggestedEmails = [
    ...new Set(
      matchingTickets.flatMap((ticket) => {
        const suggestion = assessEmailAddress(ticket.email).suggestion;
        return suggestion ? [suggestion] : [];
      }),
    ),
  ];
  const candidateEmail = recipientEmail?.trim() || suggestedEmails[0] || "";
  if (!recipientEmail && suggestedEmails.length !== 1) {
    throw new EmailOperationError(
      409,
      "This address does not have one safe automatic correction. Enter the confirmed address.",
    );
  }
  const normalizedEmail = normaliseEmail(candidateEmail);
  const assessment = assessEmailAddress(normalizedEmail);
  if (!assessment.valid) {
    throw new EmailOperationError(
      400,
      (assessment.message ?? "Enter a valid corrected email address") +
        (assessment.suggestion ? " Try " + assessment.suggestion + "." : ""),
    );
  }
  const alreadyCorrected = tickets.some(
    (ticket) => ticket.email && normaliseEmail(ticket.email) === normalizedEmail,
  );
  if (matchingTickets.length === 0 && !alreadyCorrected) {
    throw new EmailOperationError(
      409,
      "The order address has changed since this bounce. Refresh and resend from the current ticket record.",
    );
  }

  const newRecipientHash = hashEmailRecipient(normalizedEmail);
  const newSuppression = await queryOne<{ reason: string }>(
    `select reason from email_suppressions where recipient_hash = $1`,
    [newRecipientHash],
  );
  if (newSuppression && newRecipientHash !== row.recipient_hash) {
    throw new EmailOperationError(409, "The corrected address also has an active delivery block");
  }

  if (matchingTickets.length > 0) {
    const updated = await updateTicketOrderEmail(
      context.orderId,
      matchingTickets.map((ticket) => ticket.id),
      normalizedEmail,
    );
    if (updated !== matchingTickets.length) {
      throw new EmailOperationError(409, "The ticket order changed while its address was updated");
    }
  }
  await removeEmailSuppression(row.recipient_hash);
  return resendEmailFromLedger(id, origin);
}

export async function cleanupEmailOperations(): Promise<EmailCleanupResult> {
  return transaction(async (client) => {
    const expired = await client.query<{ id: string }>(
      `update email_outbox
          set status = 'failed', message = null, locked_until = null,
              provider_status = 408,
              last_error = case
                when attempts >= $1 then 'Delivery stopped after the retry limit'
                else 'Delivery window expired before the provider accepted the message'
              end,
              failed_at = now(), updated_at = now()
        where (status = 'pending' or (status = 'processing' and locked_until < now()))
          and (attempts >= $1 or content_expires_at <= now())
        returning id`,
      [EMAIL_MAX_DELIVERY_ATTEMPTS],
    );
    if (expired.rows.length > 0) {
      await client.query(
        `update communication_stage_deliveries
            set status = 'failed', updated_at = now()
          where outbox_id = any($1::uuid[]) and status in ('queued', 'accepted')`,
        [expired.rows.map((row) => row.id)],
      );
    }
    const deliveryEvents = await client.query(
      `delete from email_delivery_events
        where received_at < now() - ($1 * interval '1 day')`,
      [EMAIL_DELIVERY_EVENT_RETENTION_DAYS],
    );
    const ledger = await client.query(
      `delete from email_outbox
        where status in ('accepted', 'failed', 'cancelled') and retain_until <= now()`,
    );
    return {
      expiredMessages: expired.rowCount ?? 0,
      deletedLedgerEntries: ledger.rowCount ?? 0,
      deletedDeliveryEvents: deliveryEvents.rowCount ?? 0,
    };
  });
}
