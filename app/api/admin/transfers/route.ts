import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listAdminTransfers } from "@/lib/admin-transfers";
import { apiErrorFromRequest } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const transfers = await listAdminTransfers();
    return NextResponse.json({ transfers });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.list", "Failed to load transfers", error);
  }
}
