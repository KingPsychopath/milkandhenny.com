"use client";

import { useState } from "react";

import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { captureDiagnosticContext, newDiagnosticId, recordDiagnosticAction } from "./diagnostics";
import { DiagnosticDetails } from "./DiagnosticDetails";
import type { ReportType } from "./report-policy";
import type { ReportInputByType, ReportDiagnosticsInput } from "./types";

type ReportResponse = {
  error?: string;
  reportId?: string;
  diagnosticId?: string;
  accepted?: boolean;
  duplicate?: boolean;
};

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
}: {
  type: Type;
  payload: ReportInputByType[Type];
  label?: string;
  error?: unknown;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "duplicate" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [responseError, setResponseError] = useState("");
  const [reportId, setReportId] = useState("");
  const [diagnosticId] = useState(newDiagnosticId);
  const [idempotencyKey] = useState(() => `report_${newDiagnosticId()}`);
  const [diagnostics, setDiagnostics] = useState<ReportDiagnosticsInput>(() =>
    captureDiagnosticContext({ diagnosticId, error }),
  );

  const submit = async () => {
    if (status === "sending" || status === "sent" || status === "duplicate") return;
    setStatus("sending");
    setErrorMessage("");
    setResponseError("");
    recordDiagnosticAction("report.clicked", { type });
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
          }),
        },
        { retryMethods: ["POST"], retries: 2, timeoutMs: 10_000 },
      );
      const result = (await response.json().catch(() => null)) as ReportResponse | null;
      if (!response.ok) {
        setResponseError(result?.error ?? `HTTP ${response.status}`);
        setErrorMessage(failureMessage(response.status));
        setStatus("error");
        return;
      }
      setReportId(result?.reportId ?? "");
      setStatus(result?.duplicate ? "duplicate" : "sent");
    } catch (caught) {
      setResponseError(caught instanceof Error ? caught.message : "request failed");
      setErrorMessage("could not send that — try again");
      setStatus("error");
    }
  };

  return (
    <div
      className={`mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro theme-muted ${className}`}
    >
      <button
        type="button"
        disabled={status === "sending" || status === "sent" || status === "duplicate"}
        onClick={() => void submit()}
        className="inline-flex min-h-11 items-center transition-opacity hover:opacity-70 disabled:opacity-60"
      >
        {status === "sending"
          ? "saving context…"
          : status === "sent"
            ? "thank you — we have it"
            : status === "duplicate"
              ? "we already have this — thank you"
              : label}
      </button>
      <span aria-live="polite">
        {status === "error" ? errorMessage : reportId ? `reference ${diagnosticId}` : ""}
      </span>
      <DiagnosticDetails diagnostics={diagnostics} responseError={responseError} />
    </div>
  );
}

export type { ReportDiagnosticsInput };
