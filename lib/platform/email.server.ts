import { log } from "./logger.server";

/**
 * Provider-neutral transactional email.
 *
 * Mirrors the posture of `redis.server.ts` and `r2.server.ts`: the
 * application contract is `EMAIL_*`, and the provider behind it is a
 * deployment detail. Cloudflare Email Service is the default; Resend is a
 * drop-in alternative selected by `EMAIL_PROVIDER`.
 *
 * Ticket delivery should be sent from a dedicated subdomain so bulk or
 * announcement mail can never damage the reputation of the domain carrying
 * someone's entry to an event.
 */

export type EmailProvider = "cloudflare" | "resend";

export type EmailConfig = {
  provider: EmailProvider;
  apiKey: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  /** Cloudflare only: the account that owns the sending domain. */
  accountId?: string;
};

/** Inline image, referenced from HTML as `cid:<contentId>`. */
export type EmailAttachment = {
  /** Base64-encoded, without a data: prefix. */
  content: string;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
  contentId?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  /** Always required. Ticket mail must survive image blocking and HTML stripping. */
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; status: number; error: string };

function readProvider(): EmailProvider {
  const raw = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  return raw === "resend" ? "resend" : "cloudflare";
}

export function getEmailConfig(): EmailConfig | null {
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;

  const provider = readProvider();
  // Falls back to the R2 account only as a convenience; a dedicated,
  // email-scoped token and account id remain the recommended setup.
  const accountId = process.env.EMAIL_ACCOUNT_ID?.trim() || process.env.R2_ACCOUNT_ID?.trim();
  if (provider === "cloudflare" && !accountId) return null;

  return {
    provider,
    apiKey,
    from,
    fromName: process.env.EMAIL_FROM_NAME?.trim() || undefined,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    accountId,
  };
}

export function isEmailConfigured(): boolean {
  return getEmailConfig() !== null;
}

/** Surfaced on `/health` alongside the other optional capabilities. */
export function describeEmailCapability(): {
  configured: boolean;
  provider: EmailProvider | null;
  from: string | null;
} {
  const config = getEmailConfig();
  return {
    configured: config !== null,
    provider: config?.provider ?? null,
    from: config?.from ?? null,
  };
}

const SEND_TIMEOUT_MS = 10_000;

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Cloudflare returns `{ success, errors[], result: { delivered, permanent_bounces, queued } }`.
 * A 200 with the recipient in `permanent_bounces` is a failure, not a send.
 */
function interpretCloudflareResponse(
  status: number,
  payload: unknown,
  to: string,
): SendEmailResult {
  const record = asRecord(payload);

  if (status < 200 || status >= 300 || record?.success !== true) {
    const errors = Array.isArray(record?.errors) ? record.errors : [];
    const first = asRecord(errors[0]);
    const message =
      typeof first?.message === "string" ? first.message : "Email provider rejected the message";
    return { ok: false, status: status || 502, error: message };
  }

  const result = asRecord(record.result);
  const bounced = Array.isArray(result?.permanent_bounces) ? result.permanent_bounces : [];
  if (bounced.includes(to)) {
    return { ok: false, status: 422, error: "Recipient address permanently bounced" };
  }

  const delivered = Array.isArray(result?.delivered) ? result.delivered : [];
  const queued = Array.isArray(result?.queued) ? result.queued : [];
  if (delivered.length === 0 && queued.length === 0) {
    return { ok: false, status: 502, error: "Provider accepted the request but delivered nothing" };
  }

  return { ok: true, id: null };
}

async function sendViaCloudflare(
  config: EmailConfig,
  message: EmailMessage,
): Promise<SendEmailResult> {
  const replyTo = message.replyTo ?? config.replyTo;
  const { status, payload } = await postJson(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
    config.apiKey,
    {
      to: message.to,
      // REST uses `address`, unlike the Workers binding's `email`.
      from: config.fromName ? { address: config.from, name: config.fromName } : config.from,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      // snake_case on REST, unlike the binding's `replyTo`.
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((attachment) => ({
              content: attachment.content,
              filename: attachment.filename,
              type: attachment.type,
              disposition: attachment.disposition,
              ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
            })),
          }
        : {}),
    },
  );

  return interpretCloudflareResponse(status, payload, message.to);
}

async function sendViaResend(config: EmailConfig, message: EmailMessage): Promise<SendEmailResult> {
  const replyTo = message.replyTo ?? config.replyTo;
  const { status, payload } = await postJson("https://api.resend.com/emails", config.apiKey, {
    from: config.fromName ? `${config.fromName} <${config.from}>` : config.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((attachment) => ({
            content: attachment.content,
            filename: attachment.filename,
            content_type: attachment.type,
            ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
          })),
        }
      : {}),
  });

  if (status >= 200 && status < 300) {
    const record = asRecord(payload);
    return { ok: true, id: typeof record?.id === "string" ? record.id : null };
  }

  const record = asRecord(payload);
  const message_ =
    typeof record?.message === "string" ? record.message : "Email provider rejected the message";
  return { ok: false, status, error: message_ };
}

/**
 * Send one transactional message.
 *
 * Never throws: callers decide whether a delivery failure should fail their
 * workflow. Issuing a ticket deliberately does not, because a ticket that
 * exists but was not emailed is recoverable, whereas a payment taken with no
 * ticket issued is not.
 */
export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const config = getEmailConfig();
  if (!config) {
    log.warn("email.send", "Email is not configured; message dropped", {
      subject: message.subject,
    });
    return { ok: false, status: 503, error: "Email is not configured" };
  }

  try {
    const result =
      config.provider === "resend"
        ? await sendViaResend(config, message)
        : await sendViaCloudflare(config, message);

    if (!result.ok) {
      log.error("email.send", "Email provider rejected the message", {
        provider: config.provider,
        status: result.status,
        error: result.error,
      });
    }
    return result;
  } catch (error) {
    log.error("email.send", "Email delivery threw", { provider: config.provider }, error);
    return { ok: false, status: 502, error: "Email delivery failed" };
  }
}
