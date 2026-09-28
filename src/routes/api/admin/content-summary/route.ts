import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getAdminContentSummary } from "@/features/admin/content-summary.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    return Response.json(await getAdminContentSummary());
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.content-summary",
      "Failed to load content summary",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/content-summary")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
