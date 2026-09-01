import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { CommunicationsService } from "@/features/communications/communications-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { describeEmailCapability } from "@/lib/platform/email.server";
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

    const ticketIds = Array.isArray(parsed.recipients)
      ? parsed.recipients.filter(isValidTicketId)
      : undefined;

    if (parsed.preview === true) {
      const result = await runEventsEffect(
        Effect.gen(function* () {
          const communications = yield* CommunicationsService;
          return yield* communications.previewEventBroadcast({ slug, subject, body, ticketIds });
        }),
        request.signal,
      );
      if (result.status === "not-found") {
        return Response.json({ error: "Event not found" }, { status: 404 });
      }
      return Response.json({
        preview: true,
        rendered: result.rendered,
        recipientCount: result.recipients.length,
        recipients: result.recipients.map((entry) => entry.name),
        emailConfigured: describeEmailCapability().configured,
      });
    }

    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      return Response.json(
        { error: "The email request is missing its delivery id" },
        { status: 400 },
      );
    }

    const result = await runEventsEffect(
      Effect.gen(function* () {
        const communications = yield* CommunicationsService;
        return yield* communications.queueEventBroadcast({
          slug,
          subject,
          body,
          ticketIds,
          requestId,
        });
      }),
      request.signal,
    );
    if (result.status === "not-found")
      return Response.json({ error: "Event not found" }, { status: 404 });
    if (result.status === "empty")
      return Response.json({ error: "Nobody selected has an email address" }, { status: 409 });
    if (result.status === "too-many")
      return Response.json(
        { error: `That's over the ${result.limit}-recipient limit` },
        { status: 400 },
      );
    return Response.json({ ok: true, queued: result.queued, requestId: result.requestId });
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
