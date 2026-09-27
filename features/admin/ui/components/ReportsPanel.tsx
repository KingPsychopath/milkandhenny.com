"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppSelect } from "@/components/AppSelect";
import { useAdminAutoRefresh } from "@/features/admin/ui/hooks/useAdminAutoRefresh";
import type { AdminReportGroup } from "@/features/reports/types";
import { adminReportsQuery } from "@/features/reports/admin-reports.queries";
import { copyText } from "@/lib/client/share";
import { AdminStatus, type AdminStatusTone } from "./AdminStatus";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";
import { REPORT_STATUSES, type ReportStatus } from "@/features/reports/report-policy";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

function reportTone(status: ReportStatus, severity: AdminReportGroup["severity"]): AdminStatusTone {
  if (status === "resolved") return "positive";
  if (status === "ignored" || status === "duplicate") return "neutral";
  if (severity === "high") return "danger";
  return "attention";
}

function formatReportedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

function contextHeading(context: AdminReportGroup["latestContext"]) {
  if ("country" in context) return `${context.country.name} · ${context.result.score}/100`;
  if ("game" in context)
    return `${context.game}${context.roomId ? ` · room ${context.roomId}` : ""}`;
  if ("fileCount" in context)
    return `${context.surface} upload${context.phase ? ` · ${context.phase}` : ""}`;
  if ("deckId" in context || "slideIndex" in context)
    return `${context.surface}${context.deckId ? ` · deck ${context.deckId}` : ""}`;
  return `${context.surface}${"operation" in context && context.operation ? ` · ${context.operation}` : ""}`;
}

function contextFacts(context: AdminReportGroup["latestContext"]) {
  if ("country" in context) {
    return [
      ["average", `${context.result.deviation}%`],
      ["border", `${context.result.borderDeviation}%`],
      ["coverage", `${context.result.coverageDeviation}%`],
      ["shape", `${context.result.silhouetteDeviation}%`],
    ] as const;
  }
  if ("game" in context) {
    return [
      ["phase", context.phase ?? "—"],
      ["connection", context.connectionState ?? "—"],
      ["sequence", context.sequence ?? "—"],
      ["revision", context.revision ?? "—"],
    ] as const;
  }
  if ("fileCount" in context) {
    return [
      ["phase", context.phase ?? "—"],
      ["files", context.fileCount ?? "—"],
      ["bytes", context.bytes ?? "—"],
      ["status", context.status ?? "—"],
    ] as const;
  }
  if ("deckId" in context || "slideIndex" in context) {
    return [
      ["operation", context.operation ?? "—"],
      ["slide", context.slideIndex === undefined ? "—" : context.slideIndex + 1],
      ["status", context.status ?? "—"],
      ["retryable", context.retryable === undefined ? "—" : String(context.retryable)],
    ] as const;
  }
  return [
    ["operation", "operation" in context ? (context.operation ?? "—") : "—"],
    ["error code", "errorCode" in context ? (context.errorCode ?? "—") : "—"],
    ["route", context.diagnostics.route],
    ["build", context.diagnostics.buildId],
  ] as const;
}

export function ReportsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [includeResolved, setIncludeResolved] = useState(false);
  const queryClient = useQueryClient();
  const reportsQuery = useQuery(adminReportsQuery(includeResolved));
  const reports = reportsQuery.data ?? [];
  const loading = reportsQuery.isFetching;
  const loadError = reportsQuery.error?.message ?? null;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);

  const [pollingHalted, setPollingHalted] = useState(false);

  useEffect(() => {
    const error = reportsQuery.error;
    if (error && "status" in error) {
      const status = Number(error.status);
      if (status >= 400 && status < 500) setPollingHalted(true);
    }
  }, [reportsQuery.error]);

  const loadReports = useCallback(async () => {
    try {
      await queryClient.fetchQuery({ ...adminReportsQuery(includeResolved), staleTime: 0 });
      setPollingHalted(false);
    } catch (error) {
      // A refusing scope stays wrong until a manual retry or filter change.
      if (typeof error === "object" && error && "status" in error) {
        const status = Number(error.status);
        if (status >= 400 && status < 500) setPollingHalted(true);
      }
      onError(error instanceof Error ? error.message : "Failed to load reports");
    }
  }, [queryClient, includeResolved, onError]);

  // The shared error banner is deliberately not cleared per poll — a bare
  // interval here used to wipe other panels' errors every 30 seconds.
  useAdminAutoRefresh({
    enabled: !pollingHalted,
    cadence: "monitoring",
    identity: includeResolved ? "admin-reports:history" : "admin-reports:open",
    refreshOnEnable: false,
    refresh: () => loadReports(),
  });

  const update = async (report: AdminReportGroup, status: ReportStatus) => {
    setUpdating(report.id);
    onError("");
    try {
      const response = await authFetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: report.id, status, note: notes[report.id] || undefined }),
      });
      if (!response.ok) throw new Error("Failed to update report");
      onStatus(`Report marked ${status}.`);
      await loadReports();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to update report");
    } finally {
      setUpdating(null);
    }
  };

  const copyContext = async (
    reportId: string,
    context: AdminReportGroup["latestContext"],
    userDetails: AdminReportGroup["userDetails"],
    reports: AdminReportGroup["recentReports"],
  ) => {
    const copied = await copyText(
      JSON.stringify({ latest: context, userDetails, reports }, null, 2),
    );
    if (copied) {
      setCopiedReportId(reportId);
      onStatus("Diagnostic context copied.");
    } else {
      onError("Could not copy diagnostic context.");
    }
  };

  return (
    <div id="user-reports" className="scroll-mt-6 space-y-3 border-t theme-border pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs theme-muted">user reports</p>
          <p className="mt-1 font-mono text-micro theme-faint">
            grouped by issue · ordered by active decayed priority · retained without deletion
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="inline-flex min-h-11 items-center gap-2 font-mono text-xs theme-muted">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => {
                setPollingHalted(false);
                setIncludeResolved(event.target.checked);
              }}
            />
            show history
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadReports()}
            className="min-h-11 font-mono text-xs theme-muted transition-opacity hover:opacity-60 disabled:opacity-50"
          >
            {loading ? "refreshing..." : "refresh"}
          </button>
        </div>
      </div>

      {loadError ? (
        <AdminLoadError
          message={loadError}
          retry={() => {
            setPollingHalted(false);
            void loadReports();
          }}
          retrying={loading}
        />
      ) : loading && reports.length === 0 ? (
        <AdminLoading label="Loading reports…" />
      ) : reports.length === 0 ? (
        <p className="font-mono text-xs theme-muted">
          {includeResolved ? "No reports in the retained history." : "No active reports."}
        </p>
      ) : null}

      <div className="space-y-2">
        {reports.map((report) => {
          const context = report.latestContext;
          const facts = contextFacts(context);
          return (
            <article key={report.id} className="border theme-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{contextHeading(context)}</p>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {report.label} · {report.activeCount} active / {report.count} total · priority{" "}
                    {report.priority.toFixed(2)} · {report.severity}
                  </p>
                  <p className="font-mono text-micro theme-faint">
                    latest {formatReportedAt(report.latestReportedAt)} · first{" "}
                    {formatReportedAt(report.firstReportedAt)}
                  </p>
                </div>
                <label className="flex min-h-11 items-center gap-3 font-mono text-micro theme-muted">
                  <span className="sr-only">Report status</span>
                  <AdminStatus
                    tone={reportTone(report.status, report.severity)}
                    className="uppercase"
                  >
                    {report.status}
                  </AdminStatus>
                  <AppSelect
                    value={report.status}
                    disabled={updating === report.id}
                    onValueChange={(value) => void update(report, value as ReportStatus)}
                    options={REPORT_STATUSES.map((status) => ({ value: status, label: status }))}
                    ariaLabel="Report status"
                  />
                </label>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t theme-border pt-3 font-mono text-xs sm:grid-cols-4">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="theme-faint">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>

              {report.userDetails.length ? (
                <div className="mt-3 border-t theme-border pt-3">
                  <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                    user details
                  </p>
                  <div className="mt-1 space-y-2">
                    {report.userDetails.map((detail) => (
                      <p
                        key={detail.reportId}
                        className="whitespace-pre-wrap break-words font-mono text-xs"
                      >
                        {detail.text}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t theme-border pt-3">
                <input
                  value={notes[report.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [report.id]: event.target.value }))
                  }
                  placeholder="internal note (optional)"
                  maxLength={1_000}
                  className="min-h-11 min-w-56 flex-1 border-b theme-border-strong bg-transparent px-1 font-mono text-xs text-foreground outline-none placeholder:theme-muted"
                />
                {report.status !== "investigating" ? (
                  <button
                    type="button"
                    disabled={updating === report.id}
                    onClick={() => void update(report, "investigating")}
                    className="min-h-11 px-2 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-50"
                  >
                    investigate
                  </button>
                ) : null}
                {report.status !== "resolved" ? (
                  <button
                    type="button"
                    disabled={updating === report.id}
                    onClick={() => void update(report, "resolved")}
                    className="min-h-11 px-2 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-50"
                  >
                    resolve
                  </button>
                ) : null}
              </div>

              <details className="mt-3 border-t theme-border pt-3">
                <summary className="min-h-11 cursor-pointer select-none font-mono text-xs theme-muted">
                  diagnostic context · {context.diagnostics.trail.length} recent actions
                </summary>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="min-h-11 px-2 font-mono text-xs theme-muted underline-offset-4 hover:underline"
                    onClick={() =>
                      void copyContext(report.id, context, report.userDetails, report.recentReports)
                    }
                  >
                    {copiedReportId === report.id ? "copied" : "copy context"}
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-micro theme-faint">
                  {JSON.stringify(
                    {
                      latest: context,
                      userDetails: report.userDetails,
                      reports: report.recentReports,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}
