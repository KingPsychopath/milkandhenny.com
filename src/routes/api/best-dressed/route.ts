import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { BestDressedService } from "@/features/best-dressed/best-dressed-service.server";
import type { VoteInput } from "@/features/best-dressed/best-dressed.server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";

function runBestDressed<A>(
  request: Request,
  use: (service: typeof BestDressedService.Service) => Effect.Effect<A, unknown>,
) {
  return runMultiplayerEffect(
    Effect.gen(function* () {
      return yield* use(yield* BestDressedService);
    }),
    request.signal,
  );
}

async function handleGET(request: Request) {
  try {
    return Response.json(await runBestDressed(request, (service) => service.snapshot));
  } catch (error) {
    return apiErrorFromRequest(request, "best-dressed.list", "Failed to load voting data", error);
  }
}

async function handlePOST(request: Request) {
  try {
    const input: VoteInput = await request.json();
    const result = await runBestDressed(request, (service) => service.vote(input));
    return Response.json(result.ok ? { success: true, ...result } : result, {
      status: result.ok ? 200 : result.status,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.vote",
      "Failed to submit vote. Please try again.",
      error,
    );
  }
}

async function handleDELETE(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) return stepUpError;
  try {
    const result = await runBestDressed(request, (service) => service.clear);
    return Response.json({ success: true, session: result.session });
  } catch (error) {
    return apiErrorFromRequest(request, "best-dressed.clear", "Failed to clear votes", error);
  }
}

export const Route = createFileRoute("/api/best-dressed")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
