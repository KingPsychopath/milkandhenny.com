import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { BestDressedService } from "@/features/best-dressed/best-dressed-service.server";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

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
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const result = await runBestDressed(request, (service) => service.getVotingWindow);
    return result.ok
      ? Response.json({ success: true, ...result })
      : Response.json(result, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.voting.open.get",
      "Failed to read voting window",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  let body: { minutes?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body closes the voting window.
  }
  try {
    const result = await runBestDressed(request, (service) =>
      service.setVotingWindow(body.minutes),
    );
    return result.ok
      ? Response.json({ success: true, ...result })
      : Response.json(result, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.voting.open",
      "Failed to set voting window",
      error,
    );
  }
}

export const Route = createFileRoute("/api/best-dressed/voting/open")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
