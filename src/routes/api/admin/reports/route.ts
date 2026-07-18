import { createFileRoute } from "@tanstack/react-router";
import { dismissUserReports, listAdminReportGroups } from "@/features/reports/report-store.server";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json({ reports: await listAdminReportGroups() });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.reports.list", "Failed to load reports", error);
  }
}

async function handleDELETE(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input))
      return Response.json({ error: "Invalid report selection" }, { status: 400 });
    const data = Object.fromEntries(Object.entries(input));
    if (!Array.isArray(data.ids) || data.ids.some((id) => typeof id !== "string"))
      return Response.json({ error: "Invalid report selection" }, { status: 400 });
    return Response.json({ dismissed: await dismissUserReports(data.ids) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.reports.dismiss",
      "Failed to dismiss reports",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/reports")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
