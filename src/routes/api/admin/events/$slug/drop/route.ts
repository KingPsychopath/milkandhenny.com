import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { disableEventDrop, enableEventDrop, getEventDrop } from "@/features/events/drop.server";
import { parseExpiry } from "@/features/transfers/store.server";

/** Admin control of an event's guest media drop. */

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const drop = await getEventDrop(slug);
    return Response.json({ drop });
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.drop", "Failed to load guest uploads", error);
  }
}

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const expiry = typeof record.expiry === "string" ? record.expiry : "7d";

    let expirySeconds: number;
    try {
      expirySeconds = parseExpiry(expiry);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Invalid expiry" },
        { status: 400 },
      );
    }

    const result = await enableEventDrop(slug, expirySeconds);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ drop: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.drop",
      "Failed to enable guest uploads",
      error,
    );
  }
}

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const result = await disableEventDrop(slug);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.drop",
      "Failed to disable guest uploads",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/drop")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
      DELETE: ({ request, params }) => handleDELETE(request, params.slug),
    },
  },
});
