"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminReportGroup } from "@/features/reports/types";
import { useActionDialog } from "@/hooks/useActionDialog";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

function isAdminReportGroup(value: unknown): value is AdminReportGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = Object.fromEntries(Object.entries(value));
  return (
    typeof report.id === "string" &&
    report.type === "draw_country_result_issue" &&
    typeof report.label === "string" &&
    typeof report.subjectKey === "string" &&
    Array.isArray(report.reportIds) &&
    report.reportIds.every((id) => typeof id === "string") &&
    typeof report.count === "number" &&
    typeof report.priority === "number" &&
    typeof report.halfLifeDays === "number" &&
    typeof report.firstReportedAt === "string" &&
    typeof report.latestReportedAt === "string" &&
    Array.isArray(report.recentReports) &&
    !!report.latestContext &&
    typeof report.latestContext === "object" &&
    !Array.isArray(report.latestContext)
  );
}

function parseReports(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = Object.fromEntries(Object.entries(value));
  return Array.isArray(data.reports) ? data.reports.filter(isAdminReportGroup) : [];
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

export function ReportsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [reports, setReports] = useState<AdminReportGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const { confirm, dialog } = useActionDialog();

  const loadReports = useCallback(async () => {
    setLoading(true);
    onError("");
    try {
      const response = await authFetch("/api/admin/reports");
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Failed to load reports");
      setReports(parseReports(data));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const dismiss = async (report: AdminReportGroup) => {
    const accepted = await confirm({
      eyebrow: "user reports",
      title: `Dismiss ${report.count === 1 ? "this report" : `${report.count} reports`}?`,
      description:
        "This removes the current report group. A new report can surface it again later.",
      confirmLabel: "dismiss reports",
      intent: "danger",
    });
    if (!accepted) return;
    setDismissing(report.id);
    onError("");
    try {
      const response = await authFetch("/api/admin/reports", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: report.reportIds }),
      });
      if (!response.ok) throw new Error("Failed to dismiss reports");
      setReports((current) => current.filter(({ id }) => id !== report.id));
      onStatus("Reports dismissed.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to dismiss reports");
    } finally {
      setDismissing(null);
    }
  };

  return (
    <div id="user-reports" className="border-t theme-border pt-6 space-y-3 scroll-mt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs theme-muted">user reports</p>
          <p className="mt-1 font-mono text-micro theme-faint">
            grouped by subject · ordered by decayed priority
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadReports()}
          className="min-h-11 font-mono text-xs theme-muted transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {loading ? "refreshing..." : "refresh"}
        </button>
      </div>

      {!loading && reports.length === 0 ? (
        <p className="font-mono text-xs theme-muted">No active reports.</p>
      ) : null}

      <div className="space-y-2">
        {reports.map((report) => {
          const context = report.latestContext;
          return (
            <article key={report.id} className="rounded-md border theme-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm">
                    {context.country.name} · {context.result.score}/100
                  </p>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {report.count} {report.count === 1 ? "report" : "reports"} · priority{" "}
                    {report.priority.toFixed(2)} · {report.halfLifeDays}-day half-life
                  </p>
                  <p className="font-mono text-micro theme-faint">
                    latest {formatReportedAt(report.latestReportedAt)} · {context.mode}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={dismissing === report.id}
                  onClick={() => void dismiss(report)}
                  className="min-h-11 shrink-0 font-mono text-xs theme-muted transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {dismissing === report.id ? "dismissing..." : "dismiss"}
                </button>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t theme-border pt-3 font-mono text-xs sm:grid-cols-4">
                <div>
                  <dt className="theme-faint">average</dt>
                  <dd>{context.result.deviation}%</dd>
                </div>
                <div>
                  <dt className="theme-faint">border</dt>
                  <dd>{context.result.borderDeviation}%</dd>
                </div>
                <div>
                  <dt className="theme-faint">coverage</dt>
                  <dd>{context.result.coverageDeviation}%</dd>
                </div>
                <div>
                  <dt className="theme-faint">shape</dt>
                  <dd>{context.result.silhouetteDeviation}%</dd>
                </div>
              </dl>

              <details className="mt-3 border-t theme-border pt-3">
                <summary className="min-h-11 cursor-pointer select-none font-mono text-xs theme-muted">
                  recent diagnostic context
                </summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-micro theme-faint">
                  {JSON.stringify(report.recentReports, null, 2)}
                </pre>
              </details>
            </article>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
