"use client";

import { useEffect, useRef, useState } from "react";

import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { captureDiagnosticContext, newDiagnosticId, recordDiagnosticAction } from "./diagnostics";
import { DiagnosticDetails } from "./DiagnosticDetails";
import type { ReportType } from "./report-policy";
import type { ReportInputByType, ReportDiagnosticsInput } from "./types";

type ReportResponse = {
  error?: string;
  reportId?: string;
  followUpToken?: string;
  diagnosticId?: string;
  accepted?: boolean;
  duplicate?: boolean;
  updated?: boolean;
};

function failureMessage(status: number) {
  if (status === 413) return "that report was too large";
  if (status === 429) return "we have enough reports for now — try again later";
  if (status >= 400 && status < 500) return "we could not understand those details";
  return "could not send that — try again";
}

function detailFailureMessage(status: number) {
  if (status === 404) return "that report is no longer available";
  if (status === 400) return "add a few words first";
  return "could not add that — try again";
}

function ReportDetailDialog({
  value,
  status,
  errorMessage,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  status: "idle" | "saving" | "error";
  errorMessage: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="report-detail-title"
      aria-describedby="report-detail-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto max-h-[min(40rem,calc(100vh-3rem))] w-[min(38rem,calc(100vw-3rem))] overflow-y-auto border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header className="border-b theme-border px-6 py-5">
          <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
            optional detail
          </p>
          <h2 id="report-detail-title" className="mt-2 font-serif text-2xl">
            Tell us what happened
          </h2>
          <p
            id="report-detail-description"
            className="mt-2 font-mono text-xs leading-relaxed theme-muted"
          >
            We saved the useful technical context already. A few words about what you saw can help
            us understand it.
          </p>
        </header>
        <div className="space-y-4 px-6 py-5">
          <label htmlFor="report-detail-text" className="block font-mono text-xs theme-muted">
            What did you notice?
            <textarea
              id="report-detail-text"
              autoFocus
              value={value}
              onChange={(event) => onChange(event.target.value)}
              maxLength={1_000}
              placeholder="I clicked … and then the map stopped responding."
              className="mt-2 block min-h-32 w-full resize-y border theme-border-strong bg-transparent p-3 font-mono text-sm text-foreground outline-none placeholder:theme-muted focus:border-foreground"
            />
          </label>
          <div className="flex items-start justify-between gap-4">
            <p className="font-mono text-micro theme-faint">{value.length}/1,000</p>
            {errorMessage ? (
              <p role="alert" className="text-right font-mono text-micro theme-muted">
                {errorMessage}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t theme-border pt-4">
            <button
              type="button"
              disabled={status === "saving"}
              onClick={onCancel}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-60 disabled:opacity-50"
            >
              not now
            </button>
            <button
              type="submit"
              disabled={status === "saving" || value.trim().length < 3}
              className="min-h-11 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80 disabled:opacity-50"
            >
              {status === "saving" ? "adding detail…" : "add detail"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
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
  const [requestId, setRequestId] = useState("");
  const [reportId, setReportId] = useState("");
  const [followUpToken, setFollowUpToken] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailText, setDetailText] = useState("");
  const [detailStatus, setDetailStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailError, setDetailError] = useState("");
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
    setRequestId("");
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
        setErrorMessage(failureMessage(response.status));
        setStatus("error");
        return;
      }
      setReportId(result?.reportId ?? "");
      setFollowUpToken(result?.followUpToken ?? "");
      setDetailStatus("idle");
      setDetailError("");
      setStatus(result?.duplicate ? "duplicate" : "sent");
    } catch (caught) {
      setResponseError(caught instanceof Error ? caught.message : "request failed");
      setErrorMessage("could not send that — try again");
      setStatus("error");
    }
  };

  const saveDetail = async () => {
    if (!reportId || !followUpToken || detailStatus === "saving") return;
    const userNote = detailText.trim();
    if (userNote.length < 3) {
      setDetailError("add a few words first");
      setDetailStatus("error");
      return;
    }
    setDetailStatus("saving");
    setDetailError("");
    setResponseError("");
    try {
      const response = await fetchWithRetry(
        "/api/reports",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportId, followUpToken, userNote }),
        },
        {
          retryMethods: ["PATCH"],
          retryStatuses: [408, 425, 500, 502, 503, 504],
          retries: 2,
          timeoutMs: 10_000,
        },
      );
      setRequestId(response.headers.get("x-request-id") ?? requestId);
      const result = (await response.json().catch(() => null)) as ReportResponse | null;
      if (!response.ok) {
        setResponseError(result?.error ?? `HTTP ${response.status}`);
        setDetailError(detailFailureMessage(response.status));
        setDetailStatus("error");
        return;
      }
      setDetailStatus("saved");
      setDetailText("");
      setDetailOpen(false);
    } catch (caught) {
      setResponseError(caught instanceof Error ? caught.message : "request failed");
      setDetailError("could not add that — try again");
      setDetailStatus("error");
    }
  };

  return (
    <div
      className={`mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro theme-muted ${className}`}
    >
      {status === "sent" || status === "duplicate" ? (
        <div className="flex min-h-11 basis-full flex-wrap items-center gap-x-3 gap-y-1 sm:basis-auto">
          <span aria-live="polite" className="inline-flex min-h-11 items-center">
            {status === "sent" ? "report submitted" : "report already submitted"}
          </span>
          {detailStatus === "saved" ? (
            <span>detail added</span>
          ) : followUpToken ? (
            <button
              type="button"
              aria-label="Add a detail to this report"
              onClick={() => {
                setDetailError("");
                setDetailStatus("idle");
                setDetailOpen(true);
              }}
              className="min-h-11 underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-70"
            >
              add a detail
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={status === "sending"}
          onClick={() => void submit()}
          className="inline-flex min-h-11 items-center transition-opacity hover:opacity-70 disabled:opacity-60"
        >
          {status === "sending" ? "saving context…" : label}
        </button>
      )}
      <span aria-live="polite">
        {status === "error"
          ? `${errorMessage}${requestId ? ` · reference ${requestId}` : ""}`
          : reportId
            ? `reference ${diagnosticId}`
            : ""}
      </span>
      <DiagnosticDetails diagnostics={diagnostics} responseError={responseError} />
      {detailOpen ? (
        <ReportDetailDialog
          value={detailText}
          status={detailStatus === "saved" ? "idle" : detailStatus}
          errorMessage={detailError}
          onChange={setDetailText}
          onCancel={() => setDetailOpen(false)}
          onSubmit={() => void saveDetail()}
        />
      ) : null}
    </div>
  );
}

export type { ReportDiagnosticsInput };
