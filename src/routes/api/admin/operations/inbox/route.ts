import { createFileRoute } from "@tanstack/react-router";

import { requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  listAdminInbox,
  setAdminNotificationReadState,
  updateAdminNotification,
  type AdminInboxItem,
} from "@/features/attendee-operations/notifications.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { reconcileEmailDeliveryAttention } from "@/features/email-operations/delivery-feedback.server";

async function handleGET(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  const viewer = notificationViewer(auth);
  try {
    await reconcileEmailDeliveryAttention();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as AdminInboxItem["status"] | null;
    const valid = ["new", "in-progress", "resolved", "dismissed"].includes(status ?? "");
    const severity = url.searchParams.get("severity");
    const validSeverity = ["info", "prompt", "warning", "critical"].includes(severity ?? "");
    return Response.json(
      await listAdminInbox({
        viewer,
        status: valid ? (status ?? undefined) : undefined,
        severity: validSeverity
          ? (severity as "info" | "prompt" | "warning" | "critical")
          : undefined,
        category: url.searchParams.get("category") || undefined,
        eventSlug: url.searchParams.get("event") || undefined,
        active: url.searchParams.get("active") === "1",
      }),
    );
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.inbox.read",
      "Could not load inbox",
      error,
    );
  }
}

async function handlePATCH(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      status?: unknown;
      reason?: unknown;
      assigneePersonId?: unknown;
      privateNote?: unknown;
      read?: unknown;
    } | null;
    if (body && typeof body.id === "string" && typeof body.read === "boolean") {
      const updated = await setAdminNotificationReadState({
        id: body.id,
        viewer: notificationViewer(auth),
        read: body.read,
      });
      return updated
        ? Response.json({ updated: true })
        : Response.json({ error: "Notification not found" }, { status: 404 });
    }
    const statuses = ["new", "in-progress", "resolved", "dismissed"] as const;
    if (
      !body ||
      typeof body.id !== "string" ||
      !statuses.some((status) => status === body.status)
    ) {
      return Response.json(
        { error: "Notification and valid status are required" },
        { status: 400 },
      );
    }
    const updated = await updateAdminNotification({
      id: body.id,
      status: body.status as AdminInboxItem["status"],
      actorId: auth.actorId ?? "root-owner",
      actorType: auth.actorType === "admin" ? "admin" : "root-owner",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      assigneePersonId:
        body.assigneePersonId === null || typeof body.assigneePersonId === "string"
          ? body.assigneePersonId
          : undefined,
      privateNote: typeof body.privateNote === "string" ? body.privateNote : undefined,
    });
    return updated
      ? Response.json({ updated: true })
      : Response.json({ error: "Notification not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.inbox.update",
      "Could not update inbox",
      error,
    );
  }
}

function notificationViewer(auth: Awaited<ReturnType<typeof requireAuthWithPayload>>) {
  return {
    actorId: auth.actorId ?? "root-owner",
    actorType: auth.actorType === "admin" ? ("admin" as const) : ("root-owner" as const),
  };
}

export const Route = createFileRoute("/api/admin/operations/inbox")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});
