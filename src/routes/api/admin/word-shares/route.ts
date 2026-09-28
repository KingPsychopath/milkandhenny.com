import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { buildSharedWordSummaries } from "@/features/words/admin-shares.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ items: [] });
  }

  try {
    const items = await buildSharedWordSummaries();
    return Response.json({ items });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-shares.list",
      "Failed to load shared pages",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: { slug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    const revoked = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* MediaMaintenanceService).revokeWordShares(slug);
      }),
      request.signal,
    );
    return Response.json({ ok: true, slug, revoked });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-shares.revoke",
      "Failed to revoke shared links",
      error,
      { slug },
    );
  }
}

export const Route = createFileRoute("/api/admin/word-shares")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
