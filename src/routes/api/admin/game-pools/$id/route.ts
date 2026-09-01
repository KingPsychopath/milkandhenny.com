import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuth } from "@/features/auth/auth.server";
import { GamePoolOperationsService } from "@/features/things/pool/game-pool-operations-service.server";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePATCH(request: Request, id: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const value = await request.json().catch(() => null);
    const entrance = await runMultiplayerEffect(
      Effect.gen(function* () {
        return yield* (yield* GamePoolOperationsService).update(id, value);
      }),
      request.signal,
    );
    if (!entrance) return Response.json({ error: "Game entrance not found" }, { status: 404 });
    return Response.json({ entrance });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "game-pools.admin.update",
      "Failed to update game entrance",
      error,
    );
  }
}

async function handlePOST(request: Request, id: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const value = await request.json().catch(() => null);
    const entrance = await runMultiplayerEffect(
      Effect.gen(function* () {
        return yield* (yield* GamePoolOperationsService).control(id, value);
      }),
      request.signal,
    );
    if (!entrance) return Response.json({ error: "Game entrance not found" }, { status: 404 });
    return Response.json({ entrance });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "game-pools.admin.control",
      "Failed to control game entrance",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/game-pools/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handlePATCH(request, params.id),
      POST: ({ request, params }) => handlePOST(request, params.id),
    },
  },
});
