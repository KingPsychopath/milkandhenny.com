import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ skipped: true, reason: "Words feature is disabled." });
  }

  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* MediaMaintenanceService).cleanupWordShares();
      }),
      request.signal,
    );

    const durationMs = Date.now() - startedAtMs;
    log.info("cron.cleanup-word-shares", "Cron word-share cleanup finished", {
      requestId,
      durationMs,
      ...result,
    });

    return Response.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-word-shares",
      "Cron word-share cleanup failed",
      error,
      {
        durationMs: Date.now() - startedAtMs,
      },
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-word-shares")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
