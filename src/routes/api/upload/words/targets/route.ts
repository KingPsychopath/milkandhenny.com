import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuth } from "@/features/auth/auth.server";
import { WordOperationsService } from "@/features/words/word-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/**
 * GET /api/upload/words/targets
 *
 * Returns suggested IDs for type-ahead:
 * - slugs: existing words
 * - assets: existing shared asset IDs
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* WordOperationsService).listTargets;
      }),
      request.signal,
    );
    return Response.json(result);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.words.targets",
      "Failed to load upload targets",
      error,
    );
  }
}

export const Route = createFileRoute("/api/upload/words/targets")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
