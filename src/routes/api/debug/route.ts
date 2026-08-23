import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { probeSystemCapabilities } from "@/features/system/capabilities.server";
import { describeEmailOutbox } from "@/lib/platform/email-outbox.server";
import { describeGamePoolOperations } from "@/features/things/pool/operations.server";
import { describeTransferMediaQueue } from "@/features/transfers/media-queue.server";

/**
 * Debug endpoint — system health/status snapshot.
 * Protected behind admin auth.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const [health, emailOutbox, gamePools, mediaQueue] = await Promise.all([
    probeSystemCapabilities(),
    describeEmailOutbox(),
    describeGamePoolOperations(),
    describeTransferMediaQueue().catch(() => null),
  ]);
  return Response.json({
    ...health,
    emailOutbox,
    gamePools,
    mediaQueue,
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
