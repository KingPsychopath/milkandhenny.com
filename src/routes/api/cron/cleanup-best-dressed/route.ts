import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cleanupPostgresBestDressed } from "@/features/best-dressed/best-dressed-postgres.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result =
      process.env.BEST_DRESSED_STORE === "postgres"
        ? await withOperationSignal(request.signal, () => cleanupPostgresBestDressed())
        : { voters: 0, tokens: 0, codes: 0 };
    log.info("cron.cleanup-best-dressed", "Expired voting credentials removed", result);
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-best-dressed",
      "Best Dressed cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-best-dressed")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
