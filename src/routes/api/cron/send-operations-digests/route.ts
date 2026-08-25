import { createFileRoute } from "@tanstack/react-router";

import { sendOperationsDigests } from "@/features/attendee-operations/notifications.server";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const auth = await requireAuth(request, "cron");
  if (auth) return auth;
  try {
    return Response.json(await sendOperationsDigests());
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.operations-digests",
      "Operations digests could not be sent",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/send-operations-digests")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
