import { createFileRoute } from "@tanstack/react-router";
import { createAdminStepUpToken } from "@/features/auth/auth.server";

/**
 * POST /api/admin/step-up
 * Re-authenticate an already-authenticated admin session and return a
 * short-lived step-up token used for destructive actions.
 */
async function handlePOST(request: Request) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return createAdminStepUpToken(
    request,
    typeof body.password === "string" ? body.password : undefined,
  );
}

export const Route = createFileRoute("/api/admin/step-up")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
