import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getAdminTransferMediaStats } from "@/features/transfers/admin.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { TransferMediaOperationsService } from "@/features/transfers/transfer-media-operations-service.server";

type ProcessMediaBody =
  | { mode?: "drain"; limit?: number }
  | { mode: "retry"; transferId?: string; mediaId?: string; filename?: string; force?: boolean }
  | { mode: "backfill"; transferId?: string }
  | { mode: "reprocess"; transferId?: string; kind?: string; mediaId?: string; filename?: string }
  | { mode: "retry-dead"; limit?: number };

function runTransferMedia<A>(
  request: Request,
  use: (service: typeof TransferMediaOperationsService.Service) => Effect.Effect<A, unknown>,
) {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* use(yield* TransferMediaOperationsService);
    }),
    request.signal,
  );
}

function transferStatusResponse(status: "missing" | "expired") {
  return status === "missing"
    ? Response.json({ error: "Transfer not found or expired" }, { status: 404 })
    : Response.json({ error: "Transfer has already expired" }, { status: 400 });
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: ProcessMediaBody;
  try {
    body = (await request.json()) as ProcessMediaBody;
  } catch {
    body = { mode: "drain" };
  }

  const mode = body.mode ?? "drain";

  try {
    if (mode === "drain") {
      // The worker drains continuously; there is nothing to poke. Report what
      // it is doing so the dashboard can show queue depth and liveness.
      const media = await getAdminTransferMediaStats();
      return Response.json({
        success: true,
        mode,
        processorMode: getMediaProcessorMode(),
        queueLength: media.queueLength,
        worker: media.worker,
      });
    }

    if (mode === "retry-dead") {
      const retried = await runTransferMedia(request, (service) =>
        service.retryDead("limit" in body && typeof body.limit === "number" ? body.limit : 25),
      );
      return Response.json({ success: true, mode, retried });
    }

    if (mode === "reprocess") {
      // Rebuild derivatives for files that are already finished — the path for
      // when the pipeline learns something new and existing files are stale in
      // a way their recorded state cannot reveal.
      const transferId = "transferId" in body ? body.transferId?.trim() : undefined;
      if (!transferId) {
        return Response.json({ error: "transferId is required" }, { status: 400 });
      }
      const kind = "kind" in body ? body.kind?.trim() : undefined;
      const mediaId = "mediaId" in body ? body.mediaId?.trim() : undefined;
      const filename = "filename" in body ? body.filename?.trim() : undefined;
      if (!kind && !mediaId && !filename) {
        return Response.json(
          { error: "One of kind, mediaId, or filename is required" },
          { status: 400 },
        );
      }

      const result = await runTransferMedia(request, (service) =>
        service.reprocess({ transferId, kind, mediaId, filename }),
      );
      if (result.status !== "completed") return transferStatusResponse(result.status);

      return Response.json({
        success: true,
        mode,
        transferId,
        requeuedCount: result.requeued.length,
        skippedCount: result.skipped.length,
        requeued: result.requeued,
      });
    }

    if (mode === "backfill") {
      const transferId = "transferId" in body ? body.transferId?.trim() : undefined;
      if (!transferId) {
        return Response.json({ error: "transferId is required" }, { status: 400 });
      }
      const result = await runTransferMedia(request, (service) => service.backfill(transferId));
      if (result.status !== "completed") return transferStatusResponse(result.status);
      return Response.json({
        success: true,
        mode,
        transferId,
        fileCount: result.fileCount,
      });
    }

    const transferId = "transferId" in body ? body.transferId?.trim() : undefined;
    const mediaId = "mediaId" in body ? body.mediaId?.trim() : undefined;
    const filename = "filename" in body ? body.filename?.trim() : undefined;
    if (!transferId || (!mediaId && !filename)) {
      return Response.json(
        { error: "transferId and mediaId (or filename) are required" },
        { status: 400 },
      );
    }

    const result = await runTransferMedia(request, (service) =>
      service.retry({ transferId, mediaId, filename }),
    );
    if (result.status === "missing" || result.status === "expired") {
      return transferStatusResponse(result.status);
    }
    if (result.status === "file-missing") {
      return Response.json({ error: "File not found in transfer" }, { status: 404 });
    }
    if (result.status === "refreshed-file-missing") {
      return Response.json({ error: "File not found after refresh" }, { status: 404 });
    }

    return Response.json({
      success: result.requeued,
      requeued: result.requeued,
      mode,
      transferId,
      mediaId: result.mediaId,
      filename: result.filename,
      processingStatus: result.processingStatus,
      retryCount: result.retryCount,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.transfers.process-media",
      "Failed to process transfer media request",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/transfers/process-media")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handlePOST as POST };
