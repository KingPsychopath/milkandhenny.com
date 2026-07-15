import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import {
  adminDeleteTransfer,
  getAdminTransfer,
  isSafeTransferId,
} from "@/features/transfers/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function handleGET(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { id } = await context.params;
  if (!isSafeTransferId(id)) {
    return Response.json({ error: "Invalid transfer id" }, { status: 400 });
  }

  try {
    const transfer = await getAdminTransfer(id);
    if (!transfer) {
      return Response.json({ error: "Transfer not found" }, { status: 404 });
    }
    return Response.json({ transfer });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.get", "Failed to load transfer", error, {
      id,
    });
  }
}

async function handleDELETE(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { id } = await context.params;
  if (!isSafeTransferId(id)) {
    return Response.json({ error: "Invalid transfer id" }, { status: 400 });
  }

  try {
    const result = await adminDeleteTransfer(id);
    if (!result.dataDeleted && result.deletedFiles === 0) {
      return Response.json({ error: "Transfer not found" }, { status: 404 });
    }
    return Response.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.transfers.delete",
      "Failed to delete transfer",
      error,
      {
        id,
      },
    );
  }
}

export const Route = createFileRoute("/api/admin/transfers/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
