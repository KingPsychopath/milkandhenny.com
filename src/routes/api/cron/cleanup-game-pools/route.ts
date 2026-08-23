import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cleanupGamePools } from "@/features/things/pool/operations.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  try {
    const result = await cleanupGamePools();
    log.info("cron.cleanup-game-pools", "Game-pool cleanup finished", {
      ...result,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-game-pools",
      "Game-pool cleanup failed",
      error,
      { durationMs: Date.now() - startedAt },
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-game-pools")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
