import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { adminDeleteTransfer, isSafeTransferId } from "@/lib/admin-transfers";
import { apiError } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

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
    return apiError("admin.transfers.delete", "Failed to delete transfer", error, { id });
  }
}
