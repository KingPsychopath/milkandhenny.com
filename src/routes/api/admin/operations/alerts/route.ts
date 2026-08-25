import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  listAlertRecipients,
  listAlertDeliveries,
  revokeAlertRecipient,
  saveAlertRecipient,
  sendTestAlert,
} from "@/features/attendee-operations/notifications.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function authenticate(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  return {
    auth,
    actorId: auth.actorId ?? "root-owner",
    actorType: auth.actorType === "admin" ? "admin" : "root-owner",
  } as const;
}

async function handleGET(request: Request) {
  const { auth } = await authenticate(request);
  if (auth.error) return auth.error;
  try {
    const [recipients, deliveries] = await Promise.all([
      listAlertRecipients(),
      listAlertDeliveries(),
    ]);
    return Response.json({ recipients, deliveries });
  } catch (error) {
    return apiErrorFromRequest(request, "operations-alerts.list", "Could not load alerts", error);
  }
}

async function handlePOST(request: Request) {
  const { auth, actorId, actorType } = await authenticate(request);
  if (auth.error) return auth.error;
  const stepUp = await requireAdminStepUp(request);
  if (stepUp) return stepUp;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.email !== "string" ||
      !Array.isArray(body.categories) ||
      !body.categories.every((value) => typeof value === "string") ||
      (body.cadence !== "immediate" && body.cadence !== "digest") ||
      typeof body.reason !== "string"
    ) {
      return Response.json(
        { error: "Email, categories, cadence, and reason are required" },
        { status: 400 },
      );
    }
    const saved = await saveAlertRecipient({
      email: body.email,
      categories: body.categories,
      eventSlugs:
        Array.isArray(body.eventSlugs) &&
        body.eventSlugs.every((value) => typeof value === "string")
          ? body.eventSlugs
          : [],
      cadence: body.cadence,
      digestHour: typeof body.digestHour === "number" ? body.digestHour : undefined,
      criticalOverride: body.criticalOverride !== false,
      fallback: body.fallback === true,
      quietHours:
        body.quietHours && typeof body.quietHours === "object"
          ? (body.quietHours as { start?: number; end?: number })
          : undefined,
      actorId,
      actorType,
      reason: body.reason,
    });
    return Response.json(saved, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Alert recipient could not be saved";
    return message.includes("required") ||
      message.includes("verified") ||
      message.includes("Choose")
      ? Response.json({ error: message }, { status: 400 })
      : apiErrorFromRequest(request, "operations-alerts.save", "Could not save alerts", error);
  }
}

async function handlePUT(request: Request) {
  const { auth, actorId } = await authenticate(request);
  if (auth.error) return auth.error;
  try {
    const body = (await request.json().catch(() => null)) as { recipientId?: unknown } | null;
    if (!body || typeof body.recipientId !== "string")
      return Response.json({ error: "Recipient is required" }, { status: 400 });
    return Response.json(await sendTestAlert({ recipientId: body.recipientId, actorId }));
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "operations-alerts.test",
      "Could not send test alert",
      error,
    );
  }
}

async function handleDELETE(request: Request) {
  const { auth, actorId, actorType } = await authenticate(request);
  if (auth.error) return auth.error;
  const stepUp = await requireAdminStepUp(request);
  if (stepUp) return stepUp;
  try {
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      reason?: unknown;
    } | null;
    if (!body || typeof body.id !== "string" || typeof body.reason !== "string")
      return Response.json({ error: "Recipient and reason are required" }, { status: 400 });
    return (await revokeAlertRecipient({ id: body.id, actorId, actorType, reason: body.reason }))
      ? Response.json({ revoked: true })
      : Response.json({ error: "Recipient not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "operations-alerts.revoke",
      "Could not revoke alerts",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/operations/alerts")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      PUT: ({ request }) => handlePUT(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
