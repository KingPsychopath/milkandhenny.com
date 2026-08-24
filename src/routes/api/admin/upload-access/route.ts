import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import {
  closeUploadAccess,
  getUploadAccessStatus,
  openUploadAccess,
  UPLOAD_ACCESS_DURATIONS,
  type UploadAccessDurationMinutes,
} from "@/features/auth/upload-access.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type OpenBody = {
  durationMinutes?: unknown;
};

function isDurationMinutes(value: unknown): value is UploadAccessDurationMinutes {
  return (UPLOAD_ACCESS_DURATIONS as readonly unknown[]).includes(value);
}

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    return Response.json(await getUploadAccessStatus());
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.upload-access.status",
      "Failed to load upload access",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: OpenBody;
  try {
    body = (await request.json()) as OpenBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isDurationMinutes(body.durationMinutes)) {
    return Response.json({ error: "durationMinutes must be 15 or 60" }, { status: 400 });
  }

  try {
    const window = await openUploadAccess(body.durationMinutes);
    if (!window) {
      return Response.json({ error: "Upload access storage is unavailable" }, { status: 503 });
    }
    return Response.json({
      active: true,
      openedAt: window.openedAt,
      expiresAt: window.expiresAt,
      durationMinutes: window.durationMinutes,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.upload-access.open",
      "Failed to open uploads",
      error,
    );
  }
}

async function handleDELETE(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    if (!(await closeUploadAccess())) {
      return Response.json({ error: "Upload access storage is unavailable" }, { status: 503 });
    }
    return Response.json({ active: false, revoked: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.upload-access.close",
      "Failed to close uploads",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/upload-access")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
