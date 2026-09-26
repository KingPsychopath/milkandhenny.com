import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cleanupPostgresCliAuth } from "@/features/auth/cli-auth-postgres.server";
import { cleanupPostgresTokenState } from "@/features/auth/internal/token-state-postgres.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result = await withOperationSignal(request.signal, async () => {
      const [tokens, cli] = await Promise.all([
        cleanupPostgresTokenState(),
        cleanupPostgresCliAuth(),
      ]);
      return { ...tokens, cli };
    });
    log.info("cron.cleanup-auth-state", "Expired Postgres auth state removed", result);
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.cleanup-auth-state", "Auth cleanup failed", error);
  }
}

export const Route = createFileRoute("/api/cron/cleanup-auth-state")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
