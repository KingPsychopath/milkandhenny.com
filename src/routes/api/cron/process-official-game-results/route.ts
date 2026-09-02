import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  return Response.json(
    { error: "Event scoring has been retired. This job no longer runs." },
    { status: 410 },
  );
}

export const Route = createFileRoute("/api/cron/process-official-game-results")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
