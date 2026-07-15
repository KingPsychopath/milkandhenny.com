import { createFileRoute } from "@tanstack/react-router";
import { getGuests, updateGuestCheckIn } from "@/features/guests/store";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  try {
    const guests = await getGuests();
    return Response.json(guests);
  } catch (error) {
    return apiErrorFromRequest(request, "guests.list", "Failed to fetch guests", error);
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { id, checkedIn } = body;

    if (typeof id !== "string" || typeof checkedIn !== "boolean") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    await updateGuestCheckIn(id, checkedIn);
    const guests = await getGuests();
    return Response.json(guests);
  } catch (error) {
    return apiErrorFromRequest(request, "guests.checkin", "Failed to update check-in", error);
  }
}

export const Route = createFileRoute("/api/guests")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
