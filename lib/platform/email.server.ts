import { log } from "./logger.server";
import type { EmailContext, EmailKind, EmailSource } from "../shared/email-operations";

/**
 * Provider-neutral transactional email.
 *
 * Mirrors the posture of `redis.server.ts` and `r2.server.ts`: the
 * The application contract is `EMAIL_*`; Cloudflare and Mailpit details stay
 * inside this platform adapter so the product does not depend on either API.
 *
 * Ticket delivery should be sent from a dedicated subdomain so bulk or
 * announcement mail can never damage the reputation of the domain carrying
 * someone's entry to an event.
 */

export type EmailChannel = "tickets" | "studio" | "communications";

type CloudflareEmailConfig = {
  provider: "cloudflare";
  apiKey: string;
  sender: { address: string; name: string };
  replyTo: string;
  accountId: string;
};

type MailpitEmailConfig = {
  provider: "mailpit";
  baseUrl: string;
  sender: { address: string; name: string };
  replyTo: string;
};

export type EmailConfig = CloudflareEmailConfig | MailpitEmailConfig;

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
  channel: EmailChannel;
  to: string;
  subject: string;
  /** Always required. Ticket mail must survive image blocking and HTML stripping. */
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; status: number; error: string };

const CHANNEL_SENDERS: Record<EmailChannel, { environmentVariable: string; name: string }> = {
  tickets: {
    environmentVariable: "EMAIL_TICKETS_FROM",
    name: "milk & henny tickets",
  },
  studio: {
    environmentVariable: "EMAIL_STUDIO_FROM",
    name: "milk & henny studio",
  },
  communications: {
    environmentVariable: "EMAIL_STUDIO_FROM",
    name: "milk & henny",
  },
};

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
}

function selectedProvider(): EmailConfig["provider"] | null {
  const requested = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (requested === "mailpit") return isProductionRuntime() ? null : "mailpit";
  if (requested && requested !== "cloudflare") return null;

  // A local process must never send to a real recipient by accident. Real
  // provider delivery is exercised on Railway, where the production config is
  // explicit and isolated from local credentials.
  if (requested === "cloudflare") {
    return isProductionRuntime() || process.env.NODE_ENV === "test" ? "cloudflare" : null;
  }

  if (process.env.NODE_ENV === "development") return "mailpit";
  return "cloudflare";
}

function localSender(channel: EmailChannel): { address: string; name: string } {
  const sender = CHANNEL_SENDERS[channel];
  return {
    address:
      process.env[sender.environmentVariable]?.trim() ||
      (channel === "tickets" ? "tickets@local.test" : "studio@local.test"),
    name: sender.name,
  };
}

function getEmailConfig(channel: EmailChannel): EmailConfig | null {
  const provider = selectedProvider();
  if (provider === "mailpit") {
    return {
      provider,
      baseUrl: (process.env.EMAIL_MAILPIT_URL?.trim() || "http://127.0.0.1:8025").replace(
        /\/+$/,
        "",
      ),
      sender: localSender(channel),
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || "hello@local.test",
    };
  }
  if (provider !== "cloudflare") return null;

  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  const sender = CHANNEL_SENDERS[channel];
  const address = process.env[sender.environmentVariable]?.trim();
  if (!apiKey || !address || !replyTo) return null;

  // Falls back to the R2 account only as a convenience; a dedicated,
  // email-scoped token and account id remain the recommended setup.
  const accountId = process.env.EMAIL_ACCOUNT_ID?.trim() || process.env.R2_ACCOUNT_ID?.trim();
  if (!accountId) return null;

  return {
    provider,
    apiKey,
    sender: { address, name: sender.name },
    replyTo,
    accountId,
  };
}

/** Surfaced on `/health` alongside the other optional capabilities. */
export function describeEmailCapability(): {
  configured: boolean;
  deliveryEventsConfigured: boolean;
  linkTrackingConfigured: boolean;
  provider: "cloudflare" | "mailpit" | null;
  mailpitUrl: string | null;
  senders: Record<EmailChannel, string | null>;
  replyTo: string | null;
} {
  const tickets = getEmailConfig("tickets");
  const studio = getEmailConfig("studio");
  const mailpitUrl =
    tickets?.provider === "mailpit"
      ? tickets.baseUrl
      : studio?.provider === "mailpit"
        ? studio.baseUrl
        : null;
  const provider = tickets?.provider ?? studio?.provider ?? null;
  const configured = tickets !== null && studio !== null;
  return {
    configured,
    // Mailpit is observed directly through its inbox. Cloudflare needs the
    // dedicated Queue relay secret before provider events can be trusted.
    deliveryEventsConfigured:
      provider === "mailpit" || Boolean(process.env.EMAIL_EVENT_SECRET?.trim()),
    // Links are signed by the app, so they remain independent of the sender.
    linkTrackingConfigured: configured && Boolean(process.env.AUTH_SECRET?.trim()),
    provider,
    mailpitUrl,
    senders: {
      tickets: tickets?.sender.address ?? null,
      studio: studio?.sender.address ?? null,
      communications: studio?.sender.address ?? null,
    },
    replyTo: tickets?.replyTo ?? studio?.replyTo ?? process.env.EMAIL_REPLY_TO?.trim() ?? null,
  };
}

const SEND_TIMEOUT_MS = 10_000;

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...headers },
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
 * Cloudflare returns
 * `{ success, errors[], result: { message_id, delivered, permanent_bounces, queued } }`.
 * A 200 with the recipient in `permanent_bounces` is a failure, not a send.
 * Live responses can issue a message id before either delivery array is populated.
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

  const id =
    typeof result?.message_id === "string" && result.message_id.length > 0
      ? result.message_id
      : null;
  const delivered = Array.isArray(result?.delivered) ? result.delivered : [];
  const queued = Array.isArray(result?.queued) ? result.queued : [];
  if (!id && delivered.length === 0 && queued.length === 0) {
    return { ok: false, status: 502, error: "Provider accepted the request but delivered nothing" };
  }

  return { ok: true, id };
}

async function sendViaCloudflare(
  config: CloudflareEmailConfig,
  message: EmailMessage,
  deliveryKey?: string,
): Promise<SendEmailResult> {
  const { status, payload } = await postJson(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
    config.apiKey,
    {
      to: message.to,
      // REST uses `address`, unlike the Workers binding's `email`.
      from: config.sender,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      // snake_case on REST, unlike the binding's `replyTo`.
      reply_to: config.replyTo,
      ...(deliveryKey ? { headers: { "X-Milk-Henny-Delivery": deliveryKey } } : {}),
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

async function sendViaMailpit(
  config: MailpitEmailConfig,
  message: EmailMessage,
  deliveryKey?: string,
): Promise<SendEmailResult> {
  const response = await fetch(`${config.baseUrl}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: config.sender.address, Name: config.sender.name },
      To: [{ Email: message.to }],
      ReplyTo: [{ Email: config.replyTo }],
      Subject: message.subject,
      Text: message.text,
      ...(message.html ? { HTML: message.html } : {}),
      ...(deliveryKey ? { Headers: { "X-Milk-Henny-Delivery": deliveryKey } } : {}),
      ...(message.attachments?.length
        ? {
            Attachments: message.attachments.map((attachment) => ({
              Content: attachment.content,
              Filename: attachment.filename,
              ContentType: attachment.type,
              ...(attachment.disposition === "inline" && attachment.contentId
                ? { ContentID: attachment.contentId }
                : {}),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const payload = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    const error =
      typeof payload?.Error === "string" ? payload.Error : "Mailpit rejected the message";
    return { ok: false, status: response.status || 502, error };
  }
  const id = typeof payload?.ID === "string" && payload.ID.length > 0 ? payload.ID : null;
  return { ok: true, id };
}

/**
 * Send one transactional message.
 *
 * Never throws: callers decide whether a delivery failure should fail their
 * workflow. Issuing a ticket deliberately does not, because a ticket that
 * exists but was not emailed is recoverable, whereas a payment taken with no
 * ticket issued is not.
 */
export async function deliverEmailNow(
  message: EmailMessage,
  deliveryKey?: string,
): Promise<SendEmailResult> {
  const config = getEmailConfig(message.channel);
  if (!config) {
    log.warn("email.send", "Email is not configured; delivery deferred", {
      channel: message.channel,
      subject: message.subject,
    });
    return { ok: false, status: 503, error: "Email is not configured" };
  }

  try {
    const result =
      config.provider === "mailpit"
        ? await sendViaMailpit(config, message, deliveryKey)
        : await sendViaCloudflare(config, message, deliveryKey);

    if (!result.ok) {
      log.error("email.send", "Email provider rejected the message", {
        provider: config.provider,
        channel: message.channel,
        status: result.status,
        error: result.error,
      });
    }
    return result;
  } catch (error) {
    log.error(
      "email.send",
      "Email delivery threw",
      { provider: config.provider, channel: message.channel },
      error,
    );
    return { ok: false, status: 502, error: "Email delivery failed" };
  }
}

/** Queue a message durably; the outbox owns delivery and retries. */
export async function sendEmail(
  message: EmailMessage,
  options: {
    idempotencyKey: string;
    kind: EmailKind;
    source?: EmailSource;
    context?: EmailContext;
    deliverNow?: boolean;
    notBefore?: Date;
    communicationId?: string;
  },
): Promise<SendEmailResult> {
  const { enqueueEmail } = await import("./email-outbox.server");
  return enqueueEmail(message, {
    idempotencyKey: options.idempotencyKey,
    kind: options.kind,
    source: options.source,
    context: options.context,
    deliverNow: options.deliverNow,
    notBefore: options.notBefore,
    communicationId: options.communicationId,
  });
}
