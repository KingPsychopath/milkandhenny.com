import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  deliverEmailNow,
  type EmailAttachment,
  type EmailMessage,
  type SendEmailResult,
} from "./email.server";
import { log } from "./logger.server";
import { isDatabaseConfigured, query, transaction } from "./postgres.server";

const CLAIM_LIMIT = 8;
const LOCK_SECONDS = 45;
const WORKER_INTERVAL_MS = 5_000;

interface OutboxRow {
  id: string;
  idempotency_key: string;
  message: unknown;
  attempts: number;
}

export interface QueueEmailOptions {
  idempotencyKey: string;
  deliverNow?: boolean;
  notBefore?: Date;
  communicationId?: string;
}

export interface QueuedEmail {
  message: EmailMessage;
  idempotencyKey: string;
  notBefore?: Date;
  communicationId?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isAttachment(value: unknown): value is EmailAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.content === "string" &&
    typeof item.filename === "string" &&
    typeof item.type === "string" &&
    (item.disposition === "attachment" || item.disposition === "inline") &&
    (item.contentId === undefined || typeof item.contentId === "string")
  );
}

function parseMessage(value: unknown): EmailMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    (item.channel !== "tickets" &&
      item.channel !== "studio" &&
      item.channel !== "communications") ||
    typeof item.to !== "string" ||
    typeof item.subject !== "string" ||
    typeof item.text !== "string" ||
    (item.html !== undefined && typeof item.html !== "string") ||
    (item.attachments !== undefined &&
      (!Array.isArray(item.attachments) || !item.attachments.every(isAttachment)))
  ) {
    return null;
  }
  return {
    channel: item.channel,
    to: item.to,
    subject: item.subject,
    text: item.text,
    ...(typeof item.html === "string" ? { html: item.html } : {}),
    ...(Array.isArray(item.attachments) ? { attachments: item.attachments } : {}),
  };
}

function retryDelaySeconds(attempts: number): number {
  const schedule = [60, 5 * 60, 15 * 60, 60 * 60, 4 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60];
  return schedule[Math.min(Math.max(0, attempts - 1), schedule.length - 1)] ?? 24 * 60 * 60;
}

function isPermanentFailure(result: Extract<SendEmailResult, { ok: false }>): boolean {
  return result.status === 400 || result.status === 404 || result.status === 422;
}

async function insertEmail(
  client: PoolClient,
  message: EmailMessage,
  idempotencyKey: string,
  options: Pick<QueuedEmail, "notBefore" | "communicationId"> = {},
): Promise<{ id: string; status: string }> {
  const recipientHash = hash(message.to.trim().toLowerCase());
  const suppression = await client.query(
    `select 1 from email_suppressions where recipient_hash = $1 limit 1`,
    [recipientHash],
  );
  if (suppression.rowCount) {
    throw new SuppressedRecipientError();
  }

  const id = randomUUID();
  const result = await client.query<{ id: string; status: string }>(
    `insert into email_outbox (
       id, idempotency_key, channel, recipient_hash, message, next_attempt_at, communication_id
     ) values ($1,$2,$3,$4,$5::jsonb,coalesce($6, now()),$7)
     on conflict (idempotency_key) do update
       set idempotency_key = excluded.idempotency_key
     returning id, status`,
    [
      id,
      idempotencyKey,
      message.channel,
      recipientHash,
      JSON.stringify(message),
      options.notBefore ?? null,
      options.communicationId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Email outbox did not return the queued message");
  return row;
}

class SuppressedRecipientError extends Error {
  constructor() {
    super("Recipient address is suppressed after a delivery failure");
    this.name = "SuppressedRecipientError";
  }
}

export async function enqueueEmail(
  message: EmailMessage,
  options: QueueEmailOptions,
): Promise<SendEmailResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "Email delivery queue is unavailable" };
  }
  try {
    const queued = await transaction((client) =>
      insertEmail(client, message, options.idempotencyKey, options),
    );
    if (options.deliverNow !== false && queued.status !== "accepted") {
      triggerEmailOutboxDrain();
    }
    return { ok: true, id: queued.id };
  } catch (error) {
    if (error instanceof SuppressedRecipientError) {
      log.warn("email.outbox", "Suppressed recipient was not queued", {
        channel: message.channel,
      });
      return { ok: false, status: 422, error: error.message };
    }
    log.error("email.outbox", "Could not queue email", { channel: message.channel }, error);
    return { ok: false, status: 503, error: "Email could not be queued" };
  }
}

export async function enqueueEmails(messages: readonly QueuedEmail[]): Promise<number> {
  if (messages.length === 0) return 0;
  const queued = await transaction(async (client) => {
    let queued = 0;
    for (const item of messages) {
      try {
        const result = await insertEmail(client, item.message, item.idempotencyKey, item);
        if (result.status === "pending") queued += 1;
      } catch (error) {
        if (!(error instanceof SuppressedRecipientError)) throw error;
        log.warn("email.outbox", "Suppressed recipient was omitted from batch", {
          channel: item.message.channel,
        });
      }
    }
    return queued;
  });
  triggerEmailOutboxDrain();
  return queued;
}

async function claimBatch(): Promise<OutboxRow[]> {
  return transaction(async (client) => {
    const result = await client.query<OutboxRow>(
      `with claimable as (
         select id
           from email_outbox
         where (
                  status = 'pending'
                  or (status = 'processing' and locked_until < now())
                )
            and cancelled_at is null
            and next_attempt_at <= now()
          order by next_attempt_at, created_at
          for update skip locked
          limit $1
       )
       update email_outbox as outbox
          set status = 'processing',
              attempts = attempts + 1,
              locked_until = now() + ($2 * interval '1 second'),
              updated_at = now()
         from claimable
        where outbox.id = claimable.id
       returning outbox.id, outbox.idempotency_key, outbox.message, outbox.attempts`,
      [CLAIM_LIMIT, LOCK_SECONDS],
    );
    return result.rows;
  });
}

async function finishAttempt(row: OutboxRow): Promise<void> {
  const message = parseMessage(row.message);
  if (!message) {
    await query(
      `update email_outbox
          set status = 'failed', message = null, locked_until = null,
              provider_status = 500, last_error = 'Stored email payload is invalid',
              failed_at = now(), updated_at = now()
        where id = $1 and status = 'processing'`,
      [row.id],
    );
    return;
  }

  const result = await deliverEmailNow(message, row.idempotency_key);
  if (result.ok) {
    await query(
      `update email_outbox
          set status = 'accepted', message = null, locked_until = null,
              provider_message_id = $2, provider_status = null, last_error = null,
              accepted_at = now(), updated_at = now()
        where id = $1 and status = 'processing'`,
      [row.id, result.id],
    );
    return;
  }

  const permanent = isPermanentFailure(result);
  const safeError = result.error.replaceAll(message.to, "[recipient]").slice(0, 500);
  await query(
    permanent
      ? `update email_outbox
            set status = 'failed', message = null, locked_until = null,
                provider_status = $2, last_error = $3, failed_at = now(), updated_at = now()
          where id = $1 and status = 'processing'`
      : `update email_outbox
            set status = 'pending', locked_until = null, provider_status = $2, last_error = $3,
                next_attempt_at = now() + ($4 * interval '1 second'), updated_at = now()
          where id = $1 and status = 'processing'`,
    permanent
      ? [row.id, result.status, safeError]
      : [row.id, result.status, safeError, retryDelaySeconds(row.attempts)],
  );
}

let draining: Promise<number> | null = null;

export function drainEmailOutbox(): Promise<number> {
  draining ??= (async () => {
    let handled = 0;
    for (;;) {
      const rows = await claimBatch();
      if (rows.length === 0) return handled;
      await Promise.all(rows.map(finishAttempt));
      handled += rows.length;
      if (rows.length < CLAIM_LIMIT) return handled;
    }
  })().finally(() => {
    draining = null;
  });
  return draining;
}

function triggerEmailOutboxDrain(): void {
  void drainEmailOutbox().catch((error) => {
    log.error("email.outbox", "Email delivery drain failed", {}, error);
  });
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startEmailOutboxWorker(): void {
  if (workerTimer || !isDatabaseConfigured()) return;
  triggerEmailOutboxDrain();
  workerTimer = setInterval(triggerEmailOutboxDrain, WORKER_INTERVAL_MS);
  workerTimer.unref();
}

export async function stopEmailOutboxWorker(): Promise<void> {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  await draining?.catch((error) => {
    log.error("email.outbox", "Email delivery drain failed during shutdown", {}, error);
  });
}

export async function describeEmailOutbox(): Promise<{
  available: boolean;
  pending: number;
  processing: number;
  accepted: number;
  failed: number;
  oldestPendingAt: string | null;
}> {
  if (!isDatabaseConfigured()) {
    return {
      available: false,
      pending: 0,
      processing: 0,
      accepted: 0,
      failed: 0,
      oldestPendingAt: null,
    };
  }
  try {
    const rows = await query<{
      status: string;
      count: string;
      oldest_pending_at: Date | null;
    }>(
      `select status, count(*)::text as count,
              min(created_at) filter (where status in ('pending', 'processing')) as oldest_pending_at
         from email_outbox
        group by status`,
    );
    const counts = { pending: 0, processing: 0, accepted: 0, failed: 0 };
    let oldestPendingAt: string | null = null;
    for (const row of rows) {
      const count = Number.parseInt(row.count, 10) || 0;
      if (row.status === "pending") counts.pending = count;
      if (row.status === "processing") counts.processing = count;
      if (row.status === "accepted") counts.accepted = count;
      if (row.status === "failed") counts.failed = count;
      if (row.oldest_pending_at) {
        const value = row.oldest_pending_at.toISOString();
        if (!oldestPendingAt || value < oldestPendingAt) oldestPendingAt = value;
      }
    }
    return { available: true, ...counts, oldestPendingAt };
  } catch (error) {
    log.error("email.outbox", "Could not read outbox status", {}, error);
    return {
      available: false,
      pending: 0,
      processing: 0,
      accepted: 0,
      failed: 0,
      oldestPendingAt: null,
    };
  }
}

export const __emailOutboxTesting = { isPermanentFailure, parseMessage, retryDelaySeconds };
