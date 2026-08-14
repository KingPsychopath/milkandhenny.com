import { createFileRoute } from "@tanstack/react-router";

import {
  authenticateCloudflareEmailRelay,
  parseCloudflareEmailFeedback,
  recordEmailFeedback,
} from "@/lib/platform/email-feedback.server";
import { log } from "@/lib/platform/logger.server";

type RelayItem = { id?: unknown; occurredAt?: unknown; event?: unknown };

async function handlePOST(request: Request) {
  if (!process.env.EMAIL_EVENT_SECRET?.trim()) {
    return Response.json({ error: "Email event relay is not configured" }, { status: 503 });
  }
  if (!authenticateCloudflareEmailRelay(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  const items = record && "events" in record && Array.isArray(record.events) ? record.events : null;
  if (!items || items.length === 0 || items.length > 100) {
    return Response.json({ error: "Expected 1 to 100 events" }, { status: 400 });
  }

  let events;
  try {
    events = (items as RelayItem[]).flatMap((raw) => {
      const occurredAt = typeof raw.occurredAt === "string" ? new Date(raw.occurredAt) : new Date();
      const event = parseCloudflareEmailFeedback(
        raw.event,
        typeof raw.id === "string" ? raw.id : "",
        occurredAt,
      );
      return event ? [event] : [];
    });
  } catch {
    return Response.json({ error: "Invalid Cloudflare event" }, { status: 400 });
  }

  try {
    for (const event of events) {
      await recordEmailFeedback(event);
    }
    return Response.json({ received: items.length, handled: events.length });
  } catch (error) {
    log.error("email.feedback", "Could not record Cloudflare email feedback", {}, error);
    return Response.json({ error: "Feedback could not be recorded" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/email/events/cloudflare")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
