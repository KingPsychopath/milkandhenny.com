import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getAdminTransferMediaStats, listAdminTransfers } from "@/features/transfers/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const [transfers, media] = await Promise.all([
      listAdminTransfers(),
      getAdminTransferMediaStats(),
    ]);
    return Response.json({ transfers, media });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.list", "Failed to load transfers", error);
  }
}

export const Route = createFileRoute("/api/admin/transfers")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
