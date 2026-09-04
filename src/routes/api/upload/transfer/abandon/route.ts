import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireTransferUploadAccess } from "@/features/transfers/upload-access.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  const { error: authError, access } = await requireTransferUploadAccess(request);
  if (authError) return authError;

  let body: { transferId?: string; deleteToken?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.transferId || !body.deleteToken) {
    return Response.json({ error: "Missing transfer recovery details" }, { status: 400 });
  }
  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.abandonUpload({
          transferId: body.transferId!,
          deleteToken: body.deleteToken!,
          actorJti: access.actorJti,
        });
      }),
      request.signal,
    );

    if (result.status === "reservation-mismatch") {
      return Response.json(
        { error: "That unfinished transfer does not belong to this upload session" },
        { status: 409 },
      );
    }
    if (result.status === "missing-reservation") {
      return Response.json({ status: "missing", deletedObjects: 0 });
    }
    return Response.json(result);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.abandon",
      "Could not discard the unfinished transfer. Please try again.",
      error,
      { transferId: body.transferId },
    );
  }
}

export const Route = createFileRoute("/api/upload/transfer/abandon")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});

export { handlePOST as POST };
