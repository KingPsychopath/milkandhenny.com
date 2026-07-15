import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";

/**
 * Public-file bootstrap was intentionally removed because guest exports must
 * never be deployed as anonymous static assets. Use the authenticated CSV
 * import endpoint instead.
 */
async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  return Response.json(
    {
      error: "Public CSV bootstrap was removed. Upload the CSV through the protected import flow.",
    },
    { status: 410 },
  );
}

/**
 * Force public-file bootstrap is also retired; importantly, this path no
 * longer clears data before discovering that no protected source exists.
 */
async function handleDELETE(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  return Response.json(
    {
      error:
        "Public CSV reset was removed. Upload the replacement through the protected import flow.",
    },
    { status: 410 },
  );
}

export const Route = createFileRoute("/api/admin/guests/bootstrap")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
