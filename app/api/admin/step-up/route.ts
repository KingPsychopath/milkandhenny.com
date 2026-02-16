import { NextRequest, NextResponse } from "next/server";
import { createAdminStepUpToken } from "@/lib/auth";

/**
 * POST /api/admin/step-up
 * Re-authenticate an already-authenticated admin session and return a
 * short-lived step-up token used for destructive actions.
 */
export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.password !== "string" || !body.password.trim()) {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  return createAdminStepUpToken(request, body.password);
}
