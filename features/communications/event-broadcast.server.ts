import { getEvent } from "@/features/events/store.server";
import { renderEventMessage } from "@/features/tickets/email.server";
import { listTicketsForEvent } from "@/features/tickets/store.server";
import { enqueueEmails } from "@/lib/platform/email-outbox.server";

export const MAX_EVENT_BROADCAST_RECIPIENTS = 500;

interface EventBroadcastInput {
  slug: string;
  subject: string;
  body: string;
  ticketIds?: readonly string[];
}

type PreparedEventBroadcast =
  | { status: "not-found" }
  | {
      status: "ready";
      recipients: Array<{ email: string; name: string }>;
      rendered: ReturnType<typeof renderEventMessage>;
    };

export type EventBroadcastPreview = PreparedEventBroadcast;

export type EventBroadcastQueueResult =
  | { status: "not-found" }
  | { status: "empty" }
  | { status: "too-many"; limit: number }
  | { status: "queued"; queued: number; requestId: string };

async function prepareEventBroadcast(input: EventBroadcastInput): Promise<PreparedEventBroadcast> {
  const event = await getEvent(input.slug);
  if (!event) return { status: "not-found" };

  const tickets = await listTicketsForEvent(input.slug);
  const selected = input.ticketIds ? new Set(input.ticketIds) : null;
  const byEmail = new Map<string, string>();
  for (const ticket of tickets) {
    if (ticket.status !== "valid" || !ticket.email || (selected && !selected.has(ticket.id))) {
      continue;
    }
    const email = ticket.email.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, ticket.holderName);
  }

  return {
    status: "ready",
    recipients: [...byEmail.entries()].map(([email, name]) => ({ email, name })),
    rendered: renderEventMessage({ event, subject: input.subject, body: input.body }),
  };
}

export function previewEventBroadcast(input: EventBroadcastInput) {
  return prepareEventBroadcast(input);
}

export async function queueEventBroadcast(
  input: EventBroadcastInput & { requestId: string },
): Promise<EventBroadcastQueueResult> {
  const prepared = await prepareEventBroadcast(input);
  if (prepared.status === "not-found") return prepared;
  if (prepared.recipients.length === 0) return { status: "empty" };
  if (prepared.recipients.length > MAX_EVENT_BROADCAST_RECIPIENTS) {
    return { status: "too-many", limit: MAX_EVENT_BROADCAST_RECIPIENTS };
  }

  await enqueueEmails(
    prepared.recipients.map((recipient, index) => ({
      idempotencyKey: `events:broadcast:${input.slug}:${input.requestId}:${index}`,
      kind: "event-broadcast" as const,
      source: "admin" as const,
      context: { eventSlug: input.slug },
      message: {
        channel: "tickets" as const,
        to: recipient.email,
        subject: prepared.rendered.subject,
        text: prepared.rendered.text,
        html: prepared.rendered.html,
      },
    })),
  );

  return { status: "queued", queued: prepared.recipients.length, requestId: input.requestId };
}
