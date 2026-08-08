import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  deleteCheckpoint,
  getCheckpointSummaries,
  listCheckpoints,
  upsertCheckpoint,
} from "@/features/tickets/checkpoints.server";
import { isValidCheckpointId, slugifyCheckpointName } from "@/features/tickets/checkpoint-types";

/**
 * Admin checkpoint management for one event.
 *
 * Checkpoints are the extra scan stations (catering, merch); the door is
 * built in and never appears here.
 */

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const [checkpoints, summaries] = await Promise.all([
      listCheckpoints(slug),
      getCheckpointSummaries(slug),
    ]);
    return Response.json({ checkpoints, summaries });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.checkpoints",
      "Failed to load checkpoints",
      error,
    );
  }
}

async function handlePUT(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : slugifyCheckpointName(name);
    if (!isValidCheckpointId(id)) {
      return Response.json({ error: "Give the checkpoint a usable name" }, { status: 400 });
    }

    const allowances: Record<string, number> = {};
    if (record.allowances && typeof record.allowances === "object") {
      for (const [key, value] of Object.entries(record.allowances as Record<string, unknown>)) {
        if (typeof value === "number") allowances[key] = value;
      }
    }

    const result = await upsertCheckpoint({
      eventSlug: slug,
      id,
      name,
      defaultAllowance: typeof record.defaultAllowance === "number" ? record.defaultAllowance : 1,
      allowances,
      position: typeof record.position === "number" ? record.position : 0,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ checkpoint: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.checkpoints",
      "Failed to save checkpoint",
      error,
    );
  }
}

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    const id =
      body && typeof body === "object" && "id" in body && typeof body.id === "string"
        ? body.id
        : "";
    const result = await deleteCheckpoint(slug, id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.checkpoints",
      "Failed to delete checkpoint",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/checkpoints")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      PUT: ({ request, params }) => handlePUT(request, params.slug),
      DELETE: ({ request, params }) => handleDELETE(request, params.slug),
    },
  },
});
