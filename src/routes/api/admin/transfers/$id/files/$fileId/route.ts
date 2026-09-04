import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleDELETE(request: Request, id: string, fileId: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const removal = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.adminRemoveFile({ id, fileId });
      }),
      request.signal,
    );
    if (removal.status === "missing") {
      return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
    }
    if (removal.status === "file-missing") {
      return Response.json({ error: "File not found in transfer" }, { status: 404 });
    }
    return Response.json({
      success: true,
      deletedObjects: removal.deletedObjects,
      deletedTransfer: removal.status === "deleted",
      deletedFileId: fileId,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.transfers.remove-file",
      "Failed to remove transfer file",
      error,
      { id, fileId },
    );
  }
}

export const Route = createFileRoute("/api/admin/transfers/$id/files/$fileId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, params.id, params.fileId),
    },
  },
});

export { handleDELETE as DELETE };
