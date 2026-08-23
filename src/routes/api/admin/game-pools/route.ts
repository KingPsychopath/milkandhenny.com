import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { createGamePoolForAdmin, listGamePoolsForAdmin } from "@/features/things/pool/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json({ entrances: await listGamePoolsForAdmin() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "game-pools.admin.list",
      "Failed to list game entrances",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const entrance = await createGamePoolForAdmin(await request.json().catch(() => null));
    return Response.json({ entrance }, { status: 201 });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "game-pools.admin.create",
      "Failed to create game entrance",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/game-pools")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
