import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  let body: { mode?: "cleanup" | "purge" | "reset" };
  try {
    body = (await request.json()) as { mode?: "cleanup" | "purge" | "reset" };
  } catch {
    body = {};
  }
  const mode = body.mode ?? "cleanup";
  if (!["cleanup", "purge", "reset"].includes(mode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const maintenance = yield* MediaMaintenanceService;
        return mode === "cleanup"
          ? yield* maintenance.cleanupWordShares()
          : yield* maintenance.purgeWordShares();
      }),
      request.signal,
    );
    if (mode !== "cleanup") {
      return Response.json({
        ok: true,
        mode,
        ...result,
        cleanedAt: new Date().toISOString(),
      });
    }

    return Response.json({
      ok: true,
      mode,
      ...result,
      cleanedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-shares.cleanup",
      "Failed to cleanup share links",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/word-shares/cleanup")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
