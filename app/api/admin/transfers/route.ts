import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getAdminTransferMediaStats, listAdminTransfers } from "@/features/transfers/admin";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const [transfers, media] = await Promise.all([
      listAdminTransfers(),
      getAdminTransferMediaStats(),
    ]);
    return NextResponse.json({ transfers, media });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.list", "Failed to load transfers", error);
  }
}
