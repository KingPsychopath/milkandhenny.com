import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { runTransferMediaJobs } from "@/features/media/backends/worker";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 25) : 8;

  try {
    const result = await runTransferMediaJobs(limit);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to process transfer media queue",
      error,
      { limit }
    );
  }
}
