import { createFileRoute } from "@tanstack/react-router";
import {
  ReportValidationError,
  listAdminReportGroups,
  updateAdminReportGroup,
} from "@/features/reports/report-store.server";
import { REPORT_STATUSES, type ReportStatus } from "@/features/reports/report-policy";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const includeResolved = new URL(request.url).searchParams.get("includeResolved") === "1";
    return Response.json({ reports: await listAdminReportGroups(Date.now(), { includeResolved }) });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.reports.list", "Failed to load reports", error);
  }
}

async function handlePATCH(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input))
      return Response.json({ error: "Invalid report update" }, { status: 400 });
    const data = Object.fromEntries(Object.entries(input));
    if (
      typeof data.id !== "string" ||
      typeof data.status !== "string" ||
      !REPORT_STATUSES.includes(data.status as ReportStatus)
    )
      return Response.json({ error: "Invalid report update" }, { status: 400 });
    const note = typeof data.note === "string" ? data.note : undefined;
    return Response.json({
      updated: await updateAdminReportGroup(data.id, data.status as ReportStatus, note),
    });
  } catch (error) {
    if (error instanceof ReportValidationError)
      return Response.json({ error: error.message }, { status: 400 });
    return apiErrorFromRequest(request, "admin.reports.update", "Failed to update reports", error);
  }
}

export const Route = createFileRoute("/api/admin/reports")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});
