import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { BestDressedService } from "@/features/best-dressed/best-dressed-service.server";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const result = await runMultiplayerEffect(
      Effect.gen(function* () {
        return yield* (yield* BestDressedService).revokeCodes;
      }),
      request.signal,
    );
    return result.ok
      ? Response.json({ success: true, ...result })
      : Response.json(result, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.codes.revoke-all",
      "Failed to revoke vote codes",
      error,
    );
  }
}

export const Route = createFileRoute("/api/best-dressed/codes/revoke-all")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
