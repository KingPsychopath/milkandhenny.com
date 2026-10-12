import { createFileRoute } from "@tanstack/react-router";
import { getAdminWorkspaceAccess, requireAuthWithPayload } from "@/features/auth/auth.server";
import { executeSonderAction } from "@/features/sonder/admin.server";
import { readSonderEvent } from "@/features/sonder/sonder.server";
import { object } from "@/features/sonder/types";

const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, slug: string) {
  const access = await getAdminWorkspaceAccess(request);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status, headers });
  if (!access.permissions.viewOperations)
    return Response.json({ error: "Event operations access required" }, { status: 403, headers });
  if (request.method === "GET")
    return Response.json({ view: await readSonderEvent(slug) }, { headers });
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const body = object(await request.json());
    const email = body.action === "preview" || body.action === "send";
    if (email ? !access.permissions.manageCommunications : !access.permissions.manageEvents)
      return Response.json({ error: "Permission required" }, { status: 403, headers });
    return Response.json(
      await executeSonderAction(slug, body, auth.actorId ?? "root-owner", request.signal),
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sonder operation failed" },
      { status: 409, headers },
    );
  }
}
export const Route = createFileRoute("/api/admin/events/$slug/sonder")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.slug),
      POST: ({ request, params }) => handle(request, params.slug),
    },
  },
});
