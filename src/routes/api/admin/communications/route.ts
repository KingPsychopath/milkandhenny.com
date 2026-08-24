import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import {
  listCommunicationContacts,
  listCommunicationEvents,
  listCommunicationMessages,
  saveCommunication,
  setMarketingPreference,
} from "@/features/communications/communications.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const [contacts, messages, events] = await Promise.all([
      listCommunicationContacts(),
      listCommunicationMessages(),
      listCommunicationEvents(),
    ]);
    return Response.json({ contacts, messages, events });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.communications", "Could not load communications", error);
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "set-preference") {
      if (typeof body.emailHash !== "string" || typeof body.optedIn !== "boolean") {
        return Response.json({ error: "Choose a contact and a marketing preference" }, { status: 400 });
      }
      await setMarketingPreference(body.emailHash, body.optedIn);
      return Response.json({ ok: true });
    }
    const kind = body.kind;
    if (kind !== "newsletter" && kind !== "event_update" && kind !== "pitch_nudge") {
      return Response.json({ error: "Choose a message type" }, { status: 400 });
    }
    const data = await saveCommunication({
      kind,
      audience: typeof body.audience === "string" ? body.audience : "",
      eventSlug: typeof body.eventSlug === "string" ? body.eventSlug : null,
      subject: typeof body.subject === "string" ? body.subject : "",
      body: typeof body.body === "string" ? body.body : "",
      media: body.media,
      selectedContactHashes: Array.isArray(body.selectedContactHashes)
        ? body.selectedContactHashes.filter((value): value is string => typeof value === "string")
        : [],
      scheduledAt: typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null,
      request,
    });
    return Response.json({ communication: data });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.communications", "Could not save communication", error);
  }
}

export const Route = createFileRoute("/api/admin/communications")({
  server: { handlers: {
    GET: ({ request }) => handleGET(request),
    POST: ({ request }) => handlePOST(request),
  } },
});
