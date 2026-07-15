import { createFileRoute } from "@tanstack/react-router";
import { removeGuest } from "@/features/guests/store";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleDELETE(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const result = await removeGuest(id ?? "");
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorFromRequest(request, "guests.remove", "Failed to remove guest", error);
  }
}

export const Route = createFileRoute("/api/admin/guests/remove")({
  server: {
    handlers: {
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
