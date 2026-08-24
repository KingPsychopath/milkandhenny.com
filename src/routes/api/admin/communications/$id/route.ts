import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cancelCommunication } from "@/features/communications/communications.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, id: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action !== "cancel") {
      return Response.json(
        { error: "That communication action is not available" },
        { status: 400 },
      );
    }
    await cancelCommunication(id);
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.communications.cancel",
      "Could not cancel communication",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/communications/$id")({
  server: { handlers: { POST: ({ request, params }) => handlePOST(request, params.id) } },
});
