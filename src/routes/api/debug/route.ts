import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { probeSystemCapabilities } from "@/features/system/capabilities.server";
import { describeEmailOutbox } from "@/lib/platform/email-outbox.server";

/**
 * Debug endpoint — system health/status snapshot.
 * Protected behind admin auth.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const [health, emailOutbox] = await Promise.all([
    probeSystemCapabilities(),
    describeEmailOutbox(),
  ]);
  return Response.json({
    ...health,
    emailOutbox,
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
