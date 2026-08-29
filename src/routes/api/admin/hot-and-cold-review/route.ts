import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getHotAndColdQualityReport } from "@/features/things/hot-and-cold/hot-and-cold-review.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json(await getHotAndColdQualityReport());
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "hot-and-cold.review",
      "Failed to load Hot and Cold quality evidence",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/hot-and-cold-review")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
