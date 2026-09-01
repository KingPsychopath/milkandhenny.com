import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;
  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.cleanup("deep");
      }),
      request.signal,
    );
    const durationMs = Date.now() - startedAtMs;
    log.info("cron.cleanup-transfers", "Cron cleanup finished", {
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
    return apiErrorFromRequest(request, "cron.cleanup-transfers", "Cron cleanup failed", error, {
      durationMs: Date.now() - startedAtMs,
    });
  }
}

export const Route = createFileRoute("/api/cron/cleanup-transfers")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
