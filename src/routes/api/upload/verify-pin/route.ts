import { createFileRoute } from "@tanstack/react-router";
import { handleVerifyRequest } from "@/features/auth/auth.server";

/** POST /api/upload/verify-pin — rate-limited, timing-safe upload gate. */
async function handlePOST(request: Request) {
  return handleVerifyRequest(request, "upload");
}

export const Route = createFileRoute("/api/upload/verify-pin")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
