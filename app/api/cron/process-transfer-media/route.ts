import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getAdminTransferMediaStats } from "@/features/transfers/admin";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  try {
    const media = await getAdminTransferMediaStats();
    return NextResponse.json({
      success: true,
      workerDisabled: true,
      queueLength: media.queueLength,
      worker: media.worker,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to inspect transfer media status",
      error,
    );
  }
}
