import { createFileRoute } from "@tanstack/react-router";

import {
  listScoreNotifications,
  markScoreNotificationsDelivered,
} from "@/features/event-scoring/store.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { getTicket } from "@/features/tickets/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function participantForTicket(ticketId: string) {
  const ticket = await getTicket(ticketId);
  const session = await getAttendeeSession();
  const access = session?.tickets.find((entry) => entry.ticketId === ticketId);
  if (!ticket || !session || !access) return null;
  return access.participantId;
}

async function handleGET(request: Request, ticketId: string) {
  try {
    const participantId = await participantForTicket(ticketId);
    if (!participantId)
      return Response.json({ error: "Open this ticket on the device first" }, { status: 404 });
    const notifications = await listScoreNotifications(participantId, { undeliveredOnly: true });
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
    const notifications = await listScoreNotifications(participantId, { limit: 100 });
    const allowed = new Set(notifications.map((notification) => notification.id));
    const count = await markScoreNotificationsDelivered(ids.filter((id) => allowed.has(id)));
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
