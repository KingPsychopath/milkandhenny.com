import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type CleanupMode = "index" | "deep";

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let mode: CleanupMode = "index";
  try {
    const body = (await request.json()) as { mode?: CleanupMode };
    if (body.mode === "deep") mode = "deep";
  } catch {
    // No body means the lightweight index pass.
  }

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.cleanup(mode);
      }),
      request.signal,
    );
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.transfers.cleanup",
      "Failed to run transfer cleanup",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/transfers/cleanup")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
