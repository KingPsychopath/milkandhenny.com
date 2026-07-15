import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getAdminTransferMediaStats } from "@/features/transfers/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  try {
    const media = await getAdminTransferMediaStats();
    return Response.json({
      success: true,
      workerDisabled: true,
      queueLength: media.queueLength,
      worker: media.worker,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to inspect transfer media status",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/process-transfer-media")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
