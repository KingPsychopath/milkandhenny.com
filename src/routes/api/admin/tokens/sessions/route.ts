import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import {
  listTokenSessions,
  TokenSessionsUnavailableError,
} from "@/features/auth/token-sessions.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    return Response.json(await listTokenSessions(limit));
  } catch (error) {
    if (error instanceof TokenSessionsUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return apiErrorFromRequest(
      request,
      "admin.tokens.sessions",
      "Failed to list token sessions",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/tokens/sessions")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
