import { createFileRoute } from "@tanstack/react-router";
import { handleVerifyRequest } from "@/features/auth/auth.server";

/** POST /api/admin/verify — rate-limited, timing-safe admin verify. */
async function handlePOST(request: Request) {
  return handleVerifyRequest(request, "admin");
}

export const Route = createFileRoute("/api/admin/verify")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
