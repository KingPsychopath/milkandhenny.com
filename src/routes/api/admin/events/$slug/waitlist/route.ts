import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import {
  listEventWaitlist,
  previewWaitlistImpact,
} from "@/features/event-waitlist/waitlist.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, slug: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json(await listEventWaitlist(slug), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.waitlist.admin",
      "Failed to load the event waitlist",
      error,
    );
  }
}

async function handlePOST(request: Request, slug: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    if (
      record.action !== "preview" ||
      !record.event ||
      typeof record.event !== "object" ||
      Array.isArray(record.event)
    ) {
      return Response.json({ error: "Invalid waitlist action" }, { status: 400 });
    }
    const result = await previewWaitlistImpact(slug, record.event as Record<string, unknown>);
    return result.ok
      ? Response.json(result.value, { headers: { "Cache-Control": "private, no-store" } })
      : Response.json(
          { error: result.error },
          { status: result.status, headers: { "Cache-Control": "private, no-store" } },
        );
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.waitlist.preview",
      "Failed to preview waitlist notifications",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/waitlist")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
