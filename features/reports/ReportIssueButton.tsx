"use client";

import { useState } from "react";

import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { captureDiagnosticContext, newDiagnosticId, recordDiagnosticAction } from "./diagnostics";
import { DiagnosticDetails } from "./DiagnosticDetails";
import {
  MIN_USER_REPORT_DETAIL_LENGTH,
  reportRequiresUserDetail,
  type ReportType,
} from "./report-policy";
import { ReportIssueDialog } from "./ReportIssueDialog";
import type { ReportDiagnosticsInput, ReportInputByType } from "./types";

type ReportResponse = {
  error?: string;
  reportId?: string;
  diagnosticId?: string;
  accepted?: boolean;
  duplicate?: boolean;
};

type SubmissionStatus = "idle" | "sending" | "sent" | "duplicate" | "error";

function failureMessage(status: number) {
  if (status === 413) return "that report was too large";
  if (status === 429) return "we have enough reports for now — try again later";
  if (status >= 400 && status < 500) return "we could not understand those details";
  return "could not send that — try again";
}

export function ReportIssueButton<Type extends ReportType>({
  type,
  payload,
  label = "something feel off? let us know",
  error,
  className = "",
  detailsPlacement = "popover",
}: {
  type: Type;
  payload: ReportInputByType[Type];
  label?: string;
  error?: unknown;
  className?: string;
  detailsPlacement?: "popover" | "inline";
}) {
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailText, setDetailText] = useState("");
  const [detailError, setDetailError] = useState("");
  const [responseError, setResponseError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [reportId, setReportId] = useState("");
  const [diagnosticId] = useState(newDiagnosticId);
  const [idempotencyKey] = useState(() => `report_${newDiagnosticId()}`);
  const [diagnostics, setDiagnostics] = useState<ReportDiagnosticsInput>(() =>
    captureDiagnosticContext({ diagnosticId, error }),
  );
  const detailRequired = reportRequiresUserDetail(type);

  const openDialog = () => {
    if (status === "sending" || status === "sent" || status === "duplicate") return;
    setStatus("idle");
    setDetailError("");
    setResponseError("");
    setRequestId("");
    recordDiagnosticAction("report.opened", { type });
    setDiagnostics(captureDiagnosticContext({ diagnosticId, error }));
    setDialogOpen(true);
  };

  const cancelDialog = () => {
    if (status === "sending") return;
    setDialogOpen(false);
    setDetailError("");
    setResponseError("");
    setStatus("idle");
  };

  const submit = async () => {
    if (status === "sending" || status === "sent" || status === "duplicate") return;
    const userNote = detailText.trim();
    if (detailRequired && userNote.length < MIN_USER_REPORT_DETAIL_LENGTH) {
      setDetailError("add a few words so we know what to investigate");
      setStatus("error");
      return;
    }
    if (userNote.length > 0 && userNote.length < MIN_USER_REPORT_DETAIL_LENGTH) {
      setDetailError("add at least three characters, or leave this blank");
      setStatus("error");
      return;
    }

    setStatus("sending");
    setDetailError("");
    setResponseError("");
    setRequestId("");
    recordDiagnosticAction("report.submitted", {
      type,
      detailIncluded: userNote.length > 0,
    });
    const currentDiagnostics = captureDiagnosticContext({ diagnosticId, error });
    setDiagnostics(currentDiagnostics);

    try {
      const response = await fetchWithRetry(
        "/api/reports",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            type,
            payload,
            diagnostics: currentDiagnostics,
            ...(userNote ? { userNote } : {}),
          }),
        },
        {
          retryMethods: ["POST"],
          retryStatuses: [408, 425, 500, 502, 503, 504],
          retries: 2,
          timeoutMs: 10_000,
        },
      );
      setRequestId(response.headers.get("x-request-id") ?? "");
      const result = (await response.json().catch(() => null)) as ReportResponse | null;
      if (!response.ok) {
        setResponseError(result?.error ?? `HTTP ${response.status}`);
        setDetailError(failureMessage(response.status));
        setStatus("error");
        return;
      }
      setReportId(result?.reportId ?? "");
      setStatus(result?.duplicate ? "duplicate" : "sent");
      setDialogOpen(false);
      setDetailText("");
    } catch (caught) {
      setResponseError(caught instanceof Error ? caught.message : "request failed");
      setDetailError("could not send that — try again");
      setStatus("error");
    }
  };

  const submitted = status === "sent" || status === "duplicate";

  return (
    <div
      className={`${
        detailsPlacement === "inline"
          ? "mt-2 flex min-h-11 w-full flex-col items-center gap-y-1"
          : "mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1"
      } font-mono text-micro theme-muted ${className}`}
    >
      {submitted ? (
        <span aria-live="polite" className="inline-flex min-h-11 items-center">
          {status === "sent" ? "report submitted" : "report already received"}
          {reportId ? ` · reference ${diagnosticId}` : ""}
        </span>
      ) : (
        <button
          type="button"
          disabled={status === "sending"}
          onClick={openDialog}
          className="inline-flex min-h-11 items-center transition-opacity hover:opacity-70 disabled:opacity-60"
        >
          {status === "sending" ? "sending report…" : label}
        </button>
      )}

      {error !== undefined || responseError ? (
        <DiagnosticDetails
          diagnostics={diagnostics}
          responseError={responseError}
          placement={detailsPlacement}
        />
      ) : null}

      {dialogOpen ? (
        <ReportIssueDialog
          detailRequired={detailRequired}
          value={detailText}
          status={status === "sending" ? "saving" : status === "error" ? "error" : "idle"}
          errorMessage={`${detailError}${requestId ? ` · reference ${requestId}` : ""}`}
          onChange={(value) => {
            setDetailText(value);
            if (detailError) {
              setDetailError("");
              setStatus("idle");
            }
          }}
          onCancel={cancelDialog}
          onSubmit={() => void submit()}
        />
      ) : null}
    </div>
  );
}

export type { ReportDiagnosticsInput };
