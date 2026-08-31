import { createFileRoute } from "@tanstack/react-router";

import {
  listScoreNotifications,
  markScoreNotificationsDelivered,
} from "@/features/event-scoring/store.server";
import { openedTicketForReference } from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function participantForTicket(ticketId: string) {
  return (await openedTicketForReference(ticketId, "scoring"))?.participantId ?? null;
}

async function handleGET(request: Request, ticketId: string) {
  try {
    const participantId = await participantForTicket(ticketId);
    if (!participantId)
      return Response.json({ error: "Open this ticket on the device first" }, { status: 404 });
    const transactionId = new URL(request.url).searchParams.get("transactionId")?.trim();
    const notifications = transactionId
      ? await listScoreNotifications(participantId, { transactionId })
      : await listScoreNotifications(participantId, { undeliveredOnly: true });
    return Response.json({ notifications }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.notifications.read",
      "Could not load score notifications",
      error,
    );
  }
}

async function handlePOST(request: Request, ticketId: string) {
  try {
    const participantId = await participantForTicket(ticketId);
    if (!participantId)
      return Response.json({ error: "Open this ticket on the device first" }, { status: 404 });
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const ids = Array.isArray(record.notificationIds)
      ? record.notificationIds.filter((value): value is string => typeof value === "string")
      : [];
    const count = await markScoreNotificationsDelivered(participantId, ids);
    return Response.json({ delivered: count });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.notifications.deliver",
      "Could not update score notifications",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/score/notifications")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.id),
      POST: ({ request, params }) => handlePOST(request, params.id),
    },
  },
});
