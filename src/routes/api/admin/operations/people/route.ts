import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { searchPeople } from "@/features/attendee-operations/directory.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const auth = await requireAuth(request, "admin");
  if (auth) return auth;
  try {
    const search = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ people: await searchPeople(search) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.people",
      "Could not search people",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/operations/people")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
