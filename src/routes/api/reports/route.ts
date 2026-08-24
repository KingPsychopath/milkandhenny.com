import { createFileRoute } from "@tanstack/react-router";
import {
  appendUserReportNote,
  ReportRateLimitError,
  ReportFollowUpError,
  ReportValidationError,
  submitUserReport,
} from "@/features/reports/report-store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const MAX_REPORT_BYTES = 100_000;
type ParsedBody = { input: unknown } | { response: Response };

async function parseBody(request: Request): Promise<ParsedBody> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES)
    return { response: Response.json({ error: "Report is too large" }, { status: 413 }) } as const;

  try {
    const body = await request.text();
    if (body.length > MAX_REPORT_BYTES)
      return {
        response: Response.json({ error: "Report is too large" }, { status: 413 }),
      } as const;
    return { input: JSON.parse(body) as unknown } as const;
  } catch {
    return { response: Response.json({ error: "Invalid report" }, { status: 400 }) } as const;
  }
}

async function handlePOST(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await submitUserReport(parsed.input, request);
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ReportValidationError)
      return Response.json(
        { error: error.message, errorCode: "invalid_report", retryable: false },
        { status: 400 },
      );
    if (error instanceof ReportRateLimitError) {
      return Response.json(
        {
          error: "We have enough reports for now. Try again later.",
          errorCode: "rate_limited",
          retryable: true,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "retry-after": String(error.retryAfterSeconds) },
        },
      );
    }
    return apiErrorFromRequest(request, "reports.submit", "Could not save this report", error);
  }
}

async function handlePATCH(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await appendUserReportNote(parsed.input);
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ReportValidationError)
      return Response.json(
        { error: error.message, errorCode: "invalid_follow_up", retryable: false },
        { status: 400 },
      );
    if (error instanceof ReportFollowUpError)
      return Response.json(
        {
          error: "That report is no longer available.",
          errorCode: "report_unavailable",
          retryable: false,
        },
        { status: 404 },
      );
    return apiErrorFromRequest(request, "reports.follow_up", "Could not save this detail", error);
  }
}

export const Route = createFileRoute("/api/reports")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});

export { handlePOST as POST };
export { handlePATCH as PATCH };
