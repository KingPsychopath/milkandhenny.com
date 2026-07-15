import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { probeSystemCapabilities } from "@/features/system/capabilities.server";

/**
 * Debug endpoint — system health/status snapshot.
 * Protected behind admin auth.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const health = await probeSystemCapabilities();
  return Response.json({
    ...health,
    help: {
      forceReload: "DELETE /api/admin/guests/bootstrap to clear and reload from CSV",
      bootstrap: "POST /api/admin/guests/bootstrap to load from CSV if empty",
    },
  });
}

export const Route = createFileRoute("/api/debug")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
