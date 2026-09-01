import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;
  try {
    const outcome = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.cleanup();
      }),
      request.signal,
    );
    if (!outcome.ok) {
      return Response.json({ success: false, error: outcome.error }, { status: outcome.status });
    }
    const result = outcome.value;
    log.info("cron.cleanup-pitches", "Pitch cleanup finished", {
      ...result,
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.cleanup-pitches", "Pitch cleanup failed", error, {
      requestId,
      durationMs: Date.now() - startedAt,
    });
  }
}

export const Route = createFileRoute("/api/cron/cleanup-pitches")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
