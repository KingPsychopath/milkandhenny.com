import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { backfillTransferMedia } from "@/features/transfers/upload.server";
import { didTransferFileChange } from "@/features/transfers/media-state";
import { getTransfer } from "@/features/transfers/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getAdminTransferMediaStats } from "@/features/transfers/admin.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { forceReprocessTransferFiles } from "@/features/transfers/media-backends/worker.server";
import { retryDeadTransferMediaJobs } from "@/features/transfers/media-queue.server";

type ProcessMediaBody =
  | { mode?: "drain"; limit?: number }
  | { mode: "retry"; transferId?: string; mediaId?: string; filename?: string; force?: boolean }
  | { mode: "backfill"; transferId?: string }
  | { mode: "reprocess"; transferId?: string; kind?: string; mediaId?: string; filename?: string }
  | { mode: "retry-dead"; limit?: number };

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
      const retried = await retryDeadTransferMediaJobs(
        "limit" in body && typeof body.limit === "number" ? body.limit : 25,
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
      const transfer = await getTransfer(transferId);
      if (!transfer) {
        return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
      }
      if (Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000) <= 0) {
        return Response.json({ error: "Transfer has already expired" }, { status: 400 });
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

      const { requeued, skipped } = await forceReprocessTransferFiles(transfer, (file) => {
        if (mediaId) return file.id === mediaId;
        if (filename) return file.filename === filename;
        return file.kind === kind;
      });

      return Response.json({
        success: true,
        mode,
        transferId,
        requeuedCount: requeued.length,
        skippedCount: skipped.length,
        requeued,
      });
    }

    if (mode === "backfill") {
      const transferId = "transferId" in body ? body.transferId?.trim() : undefined;
      if (!transferId) {
        return Response.json({ error: "transferId is required" }, { status: 400 });
      }
      const transfer = await getTransfer(transferId);
      if (!transfer) {
        return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
      }
      const updated = await backfillTransferMedia(transfer);
      return Response.json({
        success: true,
        mode,
        transferId,
        fileCount: updated.files.length,
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

    const transfer = await getTransfer(transferId);
    if (!transfer) {
      return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
    }

    if (Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000) <= 0) {
      return Response.json({ error: "Transfer has already expired" }, { status: 400 });
    }

    const target = transfer.files.find((file) =>
      mediaId ? file.id === mediaId : file.filename === filename,
    );
    if (!target) {
      return Response.json({ error: "File not found in transfer" }, { status: 404 });
    }

    const updatedTransfer = await backfillTransferMedia(transfer);
    const updatedFile = updatedTransfer.files.find((file) => file.id === target.id);
    if (!updatedFile) {
      return Response.json({ error: "File not found after refresh" }, { status: 404 });
    }
    const didRetry = didTransferFileChange(target, updatedFile);

    return Response.json({
      success: didRetry,
      requeued: didRetry,
      mode,
      transferId,
      mediaId: target.id,
      filename: target.filename,
      processingStatus: updatedFile.processingStatus,
      retryCount: updatedFile.retryCount ?? 0,
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
