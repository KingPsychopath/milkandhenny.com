import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getAdminSystemHealth } from "@/features/system/admin-health.server";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  return Response.json(await getAdminSystemHealth(), { headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/debug")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
