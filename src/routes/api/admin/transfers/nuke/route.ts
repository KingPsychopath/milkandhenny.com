import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/**
 * Hard reset for transfers: deletes all transfer files + transfer metadata.
 * Admin-only and intentionally destructive.
 */
async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.nuke;
      }),
      request.signal,
    );
    if (!result.configured) {
      return Response.json({ error: "Redis or R2 not configured" }, { status: 503 });
    }

    return Response.json({
      success: true,
      deletedFiles: result.deletedFiles,
      deletedTransfers: result.deletedTransfers,
      timestamp: result.timestamp,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.nuke", "Failed to nuke transfers", error);
  }
}

export const Route = createFileRoute("/api/admin/transfers/nuke")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
