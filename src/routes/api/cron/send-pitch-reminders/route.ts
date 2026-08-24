import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";
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
        return yield* pitches.runAutomaticReminders({ origin: getBaseUrlForRequest(request) });
      }),
    );
    if (!outcome.ok) {
      return Response.json({ success: false, error: outcome.error }, { status: outcome.status });
    }
    log.info("cron.send-pitch-reminders", "Pitch reminder run finished", {
      ...outcome.value,
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({
      success: true,
      ...outcome.value,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.send-pitch-reminders",
      "Pitch reminder run failed",
      error,
      { requestId, durationMs: Date.now() - startedAt },
    );
  }
}

export const Route = createFileRoute("/api/cron/send-pitch-reminders")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
