import { createFileRoute } from "@tanstack/react-router";
import { parseCSV } from "@/features/guests/csv-parser";
import { setGuests } from "@/features/guests/store";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const content = await file.text();
    const guests = parseCSV(content);
    await setGuests(guests);

    return Response.json({ success: true, count: guests.length });
  } catch (error) {
    return apiErrorFromRequest(request, "guests.import", "Failed to import CSV", error);
  }
}

export const Route = createFileRoute("/api/admin/guests/import")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
