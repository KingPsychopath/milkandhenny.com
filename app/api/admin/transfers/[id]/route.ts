import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/lib/auth";
import { adminDeleteTransfer, isSafeTransferId } from "@/lib/admin-transfers";
import { apiErrorFromRequest } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { id } = await context.params;
  if (!isSafeTransferId(id)) {
    return NextResponse.json({ error: "Invalid transfer id" }, { status: 400 });
  }

  try {
    const result = await adminDeleteTransfer(id);
    if (!result.dataDeleted && result.deletedFiles === 0) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.delete", "Failed to delete transfer", error, {
      id,
    });
  }
}
