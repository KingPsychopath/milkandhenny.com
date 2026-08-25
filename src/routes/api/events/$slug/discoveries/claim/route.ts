import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";

import {
  claimDiscovery,
  findDiscoveryForPresented,
} from "@/features/event-scoring/discoveries.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";
import { rateLimitClaim } from "@/features/tickets/tickets.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, slug: string) {
  try {
    if (!(await rateLimitClaim(getRequestIP() || "unknown"))) {
      return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
    const participantId = await activeParticipantForEvent(slug);
    if (!participantId) {
      return Response.json({ error: "Open your ticket before claiming a clue" }, { status: 401 });
    }
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const presented = typeof record.presented === "string" ? record.presented.trim() : "";
    const commandId = typeof record.commandId === "string" ? record.commandId : "";
    if (!presented || presented.length > 500 || !/^[A-Za-z0-9_-]{16,100}$/.test(commandId)) {
      return Response.json({ error: "Enter the clue and try again" }, { status: 400 });
    }
    const discovery = await findDiscoveryForPresented(slug, presented);
    if (!discovery) {
      return Response.json(
        { error: "That clue does not match an active discovery" },
        { status: 400 },
      );
    }
    const result = await claimDiscovery({
      discoveryId: discovery.id,
      participantId,
      presented,
      commandId,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(
      { ...result.value, discovery: { id: discovery.id, name: discovery.name } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.discovery-claim-any",
      "Could not claim the clue",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/discoveries/claim")({
  server: { handlers: { POST: ({ request, params }) => handlePOST(request, params.slug) } },
});
