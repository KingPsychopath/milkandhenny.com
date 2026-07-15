import { createFileRoute } from "@tanstack/react-router";
import {
  requireAuth,
  requireAdminStepUp,
  revokeAllRoleTokens,
  revokeRoleTokens,
  type RevocableRole,
} from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

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
async function handlePOST(request: Request) {
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
    return Response.json(
      { error: "role must be one of: admin, staff, upload, all" },
      { status: 400 },
    );
  }

  try {
    const revoked = role === "all" ? await revokeAllRoleTokens() : [await revokeRoleTokens(role)];

    return Response.json({
      success: true,
      revoked,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.tokens.revoke", "Failed to revoke tokens", error);
  }
}

export const Route = createFileRoute("/api/admin/tokens/revoke")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
