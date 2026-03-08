import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { wakeTransferMediaWorker } from "@/features/media/backends/worker";
import { getAdminTransferMediaStats } from "@/features/transfers/admin";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  try {
    const [wokeWorker, media] = await Promise.all([
      wakeTransferMediaWorker(),
      getAdminTransferMediaStats(),
    ]);
    return NextResponse.json({
      success: true,
      wokeWorker,
      queueLength: media.queueLength,
      worker: media.worker,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to wake transfer media worker",
      error,
    );
  }
}
