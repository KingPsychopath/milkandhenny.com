import { createFileRoute } from "@tanstack/react-router";
import { addGuest } from "@/features/guests/store";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { GuestStatus } from "@/features/guests/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const body = await request.json();
    const { name, fullName, status, plusOneOf } = body;

    const result = await addGuest({
      name,
      fullName,
      status: typeof status === "string" ? (status as GuestStatus) : undefined,
      plusOneOf,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true, guest: result.value });
  } catch (error) {
    return apiErrorFromRequest(request, "guests.add", "Failed to add guest", error);
  }
}

export const Route = createFileRoute("/api/admin/guests/add")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
