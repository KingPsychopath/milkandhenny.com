import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { describeEmailCapability } from "@/lib/platform/email.server";
import { enqueueEmails } from "@/lib/platform/email-outbox.server";
import { getEvent } from "@/features/events/store.server";
import { renderEventMessage } from "@/features/tickets/email.server";
import { listTicketsForEvent } from "@/features/tickets/store.server";
import { isValidTicketId } from "@/features/tickets/types";

/**
 * Message attendees.
 *
 * Preview never sends: it returns the exact rendered email plus who would
 * receive it, so the send button is informed consent, not a guess.
 * Recipients are deduped by address — one household buying five tickets
 * gets one email.
 */

const MAX_BODY_LENGTH = 8_000;
const MAX_RECIPIENTS = 500;

type EmailBody = {
  subject?: unknown;
  body?: unknown;
  /** "all", or an array of ticket ids to target specific people. */
  recipients?: unknown;
  preview?: unknown;
  requestId?: unknown;
};

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const raw: unknown = await request.json().catch(() => null);
    const parsed = raw && typeof raw === "object" ? (raw as EmailBody) : {};

    const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!subject || subject.length > 150) {
      return Response.json({ error: "Give the email a subject" }, { status: 400 });
    }
    if (!body || body.length > MAX_BODY_LENGTH) {
      return Response.json({ error: "Write the message first" }, { status: 400 });
    }

    const event = await getEvent(slug);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

    const tickets = await listTicketsForEvent(slug);
    const live = tickets.filter((ticket) => ticket.status === "valid" && ticket.email);

    let targeted = live;
    if (Array.isArray(parsed.recipients)) {
      const wanted = new Set(parsed.recipients.filter(isValidTicketId));
      targeted = live.filter((ticket) => wanted.has(ticket.id));
    }

    // One email per address, however many tickets it bought.
    const byEmail = new Map<string, string>();
    for (const ticket of targeted) {
      const email = ticket.email?.trim().toLowerCase();
      if (email && !byEmail.has(email)) {
        byEmail.set(email, ticket.holderName);
      }
    }

    const rendered = renderEventMessage({ event, subject, body });
    const recipients = [...byEmail.entries()].map(([email, name]) => ({ email, name }));

    if (parsed.preview === true) {
      return Response.json({
        preview: true,
        rendered,
        recipientCount: recipients.length,
        recipients: recipients.map((entry) => entry.name),
        emailConfigured: describeEmailCapability().configured,
      });
    }

    if (recipients.length === 0) {
      return Response.json({ error: "Nobody selected has an email address" }, { status: 409 });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return Response.json(
        { error: `That's over the ${MAX_RECIPIENTS}-recipient limit` },
        { status: 400 },
      );
    }

    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      return Response.json(
        { error: "The email request is missing its delivery id" },
        { status: 400 },
      );
    }

    await enqueueEmails(
      recipients.map((recipient, index) => ({
        idempotencyKey: `events:broadcast:${slug}:${requestId}:${index}`,
        message: {
          channel: "tickets" as const,
          to: recipient.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        },
      })),
    );

    return Response.json({
      ok: true,
      queued: recipients.length,
      requestId,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.email", "Failed to send the email", error);
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/email")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
