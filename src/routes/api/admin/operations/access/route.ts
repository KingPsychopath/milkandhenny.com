import { createFileRoute } from "@tanstack/react-router";

import {
  inviteNamedAdmin,
  listNamedAdminGrants,
  revokeNamedAdmin,
} from "@/features/attendee-operations/access-grants.server";
import {
  GLOBAL_ADMIN_ROLE_PRESETS,
  type GlobalAdminRole,
} from "@/features/attendee-operations/types";
import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function authenticated(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  return {
    auth,
    actorId: auth.actorId ?? "root-owner",
    actorType: auth.actorType === "admin" ? "admin" : "root-owner",
  } as const;
}

async function handleGET(request: Request) {
  const { auth } = await authenticated(request);
  if (auth.error) return auth.error;
  try {
    return Response.json({ grants: await listNamedAdminGrants() });
  } catch (error) {
    return apiErrorFromRequest(request, "admin-access.list", "Could not load admin access", error);
  }
}

async function handlePOST(request: Request) {
  const { auth, actorId, actorType } = await authenticated(request);
  if (auth.error) return auth.error;
  const stepUp = await requireAdminStepUp(request);
  if (stepUp) return stepUp;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const rolePreset =
      typeof body?.rolePreset === "string"
        ? (Object.keys(GLOBAL_ADMIN_ROLE_PRESETS) as GlobalAdminRole[]).find(
            (role) => role === body.rolePreset,
          )
        : undefined;
    if (!body || typeof body.email !== "string" || !rolePreset || typeof body.reason !== "string") {
      return Response.json({ error: "Email, role, and reason are required" }, { status: 400 });
    }
    const result = await inviteNamedAdmin({
      email: body.email,
      name: typeof body.name === "string" ? body.name : undefined,
      rolePreset,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      actorId,
      actorType,
      reason: body.reason,
      origin: new URL(request.url).origin,
    });
    return result.ok
      ? Response.json(result.value, { status: 201 })
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(request, "admin-access.invite", "Could not invite admin", error);
  }
}

async function handleDELETE(request: Request) {
  const { auth, actorId, actorType } = await authenticated(request);
  if (auth.error) return auth.error;
  const stepUp = await requireAdminStepUp(request);
  if (stepUp) return stepUp;
  try {
    const body = (await request.json().catch(() => null)) as {
      grantId?: unknown;
      reason?: unknown;
    } | null;
    if (!body || typeof body.grantId !== "string" || typeof body.reason !== "string")
      return Response.json({ error: "Grant and reason are required" }, { status: 400 });
    return (await revokeNamedAdmin({
      grantId: body.grantId,
      actorId,
      actorType,
      reason: body.reason,
    }))
      ? Response.json({ revoked: true })
      : Response.json({ error: "Active grant not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "admin-access.revoke", "Could not revoke admin", error);
  }
}

export const Route = createFileRoute("/api/admin/operations/access")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
