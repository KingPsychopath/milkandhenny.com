import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requireAdminStepUp,
  revokeAllRoleTokens,
  revokeRoleTokens,
  type RevocableRole,
} from "@/lib/auth";
import { apiErrorFromRequest } from "@/lib/api-error";

type RevokeBody = {
  role?: RevocableRole | "all";
};

function isRevocableRole(value: unknown): value is RevocableRole {
  return value === "admin" || value === "staff" || value === "upload";
}

/**
 * POST /api/admin/tokens/revoke
 * Revokes token sessions by bumping role token version(s).
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: RevokeBody = {};
  try {
    body = (await request.json()) as RevokeBody;
  } catch {
    // Empty/invalid JSON defaults to revoking admin sessions only.
    body = {};
  }

  const role = body.role ?? "admin";
  if (role !== "all" && !isRevocableRole(role)) {
    return NextResponse.json(
      { error: "role must be one of: admin, staff, upload, all" },
      { status: 400 }
    );
  }

  try {
    const revoked =
      role === "all"
        ? await revokeAllRoleTokens()
        : [await revokeRoleTokens(role)];

    return NextResponse.json({
      success: true,
      revoked,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.tokens.revoke", "Failed to revoke tokens", error);
  }
}
