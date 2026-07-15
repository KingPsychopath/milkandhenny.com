import { createFileRoute } from "@tanstack/react-router";
import { handleVerifyRequest } from "@/features/auth/auth.server";

/** POST /api/guests/verify-staff-pin — rate-limited, timing-safe. */
async function handlePOST(request: Request) {
  return handleVerifyRequest(request, "staff");
}

export const Route = createFileRoute("/api/guests/verify-staff-pin")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
