import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import { backfillTransferMedia } from "@/features/transfers/upload";
import { didTransferFileChange } from "@/features/transfers/media-state";
import { getTransfer } from "@/features/transfers/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getAdminTransferMediaStats } from "@/features/transfers/admin";

type ProcessMediaBody =
  | { mode?: "drain"; limit?: number }
  | { mode: "retry"; transferId?: string; mediaId?: string; filename?: string; force?: boolean }
  | { mode: "backfill"; transferId?: string };

export async function POST(request: NextRequest) {
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
      const media = await getAdminTransferMediaStats();
      return NextResponse.json({
        success: true,
        mode,
        workerDisabled: true,
        processedJobs: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        queueLength: media.queueLength,
        worker: media.worker,
      });
    }

    if (mode === "backfill") {
      const transferId = "transferId" in body ? body.transferId?.trim() : undefined;
      if (!transferId) {
        return NextResponse.json({ error: "transferId is required" }, { status: 400 });
      }
      const transfer = await getTransfer(transferId);
      if (!transfer) {
        return NextResponse.json({ error: "Transfer not found or expired" }, { status: 404 });
      }
      const updated = await backfillTransferMedia(transfer);
      return NextResponse.json({
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
      return NextResponse.json(
        { error: "transferId and mediaId (or filename) are required" },
        { status: 400 }
      );
    }

    const transfer = await getTransfer(transferId);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found or expired" }, { status: 404 });
    }

    if (Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000) <= 0) {
      return NextResponse.json({ error: "Transfer has already expired" }, { status: 400 });
    }

    const target = transfer.files.find((file) =>
      mediaId ? file.id === mediaId : file.filename === filename
    );
    if (!target) {
      return NextResponse.json({ error: "File not found in transfer" }, { status: 404 });
    }

    const updatedTransfer = await backfillTransferMedia(transfer);
    const updatedFile = updatedTransfer.files.find((file) => file.id === target.id);
    if (!updatedFile) {
      return NextResponse.json({ error: "File not found after refresh" }, { status: 404 });
    }
    const didRetry = didTransferFileChange(target, updatedFile);

    return NextResponse.json({
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
      error
    );
  }
}
