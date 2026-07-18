import { createFileRoute } from "@tanstack/react-router";
import {
  ReportRateLimitError,
  ReportValidationError,
  submitUserReport,
} from "@/features/reports/report-store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const MAX_REPORT_BYTES = 100_000;

async function handlePOST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES)
    return Response.json({ error: "Report is too large" }, { status: 413 });

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid report origin" }, { status: 403 });

  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > MAX_REPORT_BYTES)
      return Response.json({ error: "Report is too large" }, { status: 413 });
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid report" }, { status: 400 });
  }

  try {
    const result = await submitUserReport(input, request);
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ReportValidationError)
      return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof ReportRateLimitError)
      return Response.json({ error: "Too many reports. Please try later." }, { status: 429 });
    return apiErrorFromRequest(request, "reports.submit", "Could not save this report", error);
  }
}

export const Route = createFileRoute("/api/reports")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
