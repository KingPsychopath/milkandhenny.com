"use client";

import type { SystemCapabilities } from "@/features/system/capabilities";
import { AdminStatus, adminToneBorderClass, adminToneForStatus } from "./AdminStatus";

type SystemHealthSnapshot = SystemCapabilities & {
  emailOutbox: {
    available: boolean;
    pending: number;
    processing: number;
    accepted: number;
    failed: number;
    cancelled: number;
    delivered: number;
    awaitingProviderFeedback: number;
    oldestPendingAt: string | null;
    latestDeliveryEventAt: string | null;
  };
  mediaQueue: {
    available: boolean;
    enabled: boolean;
    queued: number;
    leased: number;
    permanentFailures: number;
    backlogAgeMs: number | null;
    reason?: string;
  };
};

function checkedAt(value: string | undefined): string {
  if (!value) return "not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not checked";
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

function duration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 60_000) return `${Math.round(value / 1_000)}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  return `${Math.round(value / 3_600_000)}h`;
}

export function SystemHealthPanel({
  snapshot,
  loading,
  onRefresh,
}: {
  snapshot: SystemHealthSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const systemTone = adminToneForStatus(snapshot?.status ?? "checking");

  return (
    <div id="system-health" className="border-t theme-border pt-6 space-y-6 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs theme-muted">system health</p>
          <p className="mt-1 font-serif text-2xl font-semibold">
            <AdminStatus tone={systemTone}>
              {snapshot ? snapshot.status : "Not checked"}
            </AdminStatus>
          </p>
          <p className="mt-1 font-mono text-micro theme-faint">
            Core status · checked {checkedAt(snapshot?.timestamp)}. Optional capability limits are
            listed below without downgrading the core runtime.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="min-h-11 shrink-0 font-mono text-xs theme-muted transition-opacity hover:opacity-70 disabled:opacity-50"
        >
          {loading ? "checking..." : "check now"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {snapshot?.capabilities.map((capability) => (
          <article key={capability.id} className="rounded-md border theme-border p-3">
            <div
              className={
                capability.required && capability.status !== "available"
                  ? `border-l-2 pl-3 ${adminToneBorderClass(adminToneForStatus(capability.status))}`
                  : ""
              }
            >
              <div className="flex items-start justify-between gap-3 font-mono">
                <p className="text-xs theme-muted">{capability.label}</p>
                <AdminStatus tone={adminToneForStatus(capability.status)} className="text-micro">
                  {capability.status}
                </AdminStatus>
              </div>
              <p className="mt-2 font-mono text-xs leading-relaxed">{capability.detail}</p>
              <p className="mt-2 font-mono text-micro theme-faint">
                {capability.required ? "required" : "optional"}
                {typeof capability.latencyMs === "number" ? ` · ${capability.latencyMs}ms` : ""}
              </p>
            </div>
          </article>
        )) ?? <p className="font-mono text-xs theme-muted">Run a check to inspect services.</p>}
      </div>

      <section aria-labelledby="delivery-queues-heading" className="border-t theme-border pt-5">
        <h3 id="delivery-queues-heading" className="font-mono text-xs theme-muted">
          delivery queues
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <article className="rounded-md border theme-border p-3 font-mono">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs theme-muted">email</p>
              <AdminStatus
                tone={adminToneForStatus(
                  !snapshot
                    ? "not checked"
                    : snapshot.emailOutbox.available
                      ? "available"
                      : "unavailable",
                )}
                className="text-micro"
              >
                {!snapshot
                  ? "not checked"
                  : snapshot.emailOutbox.available
                    ? "available"
                    : "unavailable"}
              </AdminStatus>
            </div>
            <p className="mt-2 text-lg">
              {snapshot ? snapshot.emailOutbox.pending + snapshot.emailOutbox.processing : "—"}{" "}
              active
            </p>
            <p className="mt-1 text-micro theme-faint">
              {snapshot?.emailOutbox.pending ?? "—"} pending ·{" "}
              {snapshot?.emailOutbox.processing ?? "—"} sending ·{" "}
              {snapshot?.emailOutbox.accepted ?? "—"} provider accepted ·{" "}
              {snapshot?.emailOutbox.delivered ?? "—"} delivered ·{" "}
              {(snapshot?.emailOutbox.failed ?? 0) > 0 ? (
                <AdminStatus tone="danger">{snapshot?.emailOutbox.failed} failed</AdminStatus>
              ) : (
                <span>{snapshot?.emailOutbox.failed ?? "—"} failed</span>
              )}
            </p>
            {(snapshot?.emailOutbox.awaitingProviderFeedback ?? 0) > 0 ? (
              <AdminStatus tone="attention" className="mt-2 text-micro">
                {snapshot?.emailOutbox.awaitingProviderFeedback} accepted message
                {snapshot?.emailOutbox.awaitingProviderFeedback === 1 ? " has" : "s have"} no
                provider delivery event after 15 minutes.
              </AdminStatus>
            ) : null}
          </article>
          <article className="rounded-md border theme-border p-3 font-mono">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs theme-muted">media processing</p>
              <AdminStatus
                tone={adminToneForStatus(
                  !snapshot
                    ? "not checked"
                    : !snapshot.mediaQueue.available
                      ? "unavailable"
                      : snapshot.mediaQueue.enabled
                        ? "available"
                        : "disabled",
                )}
                className="text-micro"
              >
                {!snapshot
                  ? "not checked"
                  : !snapshot.mediaQueue.available
                    ? "unavailable"
                    : snapshot.mediaQueue.enabled
                      ? "available"
                      : "disabled"}
              </AdminStatus>
            </div>
            <p className="mt-2 text-lg">{snapshot?.mediaQueue.queued ?? "—"} queued</p>
            <p className="mt-1 text-micro theme-faint">
              {snapshot?.mediaQueue.leased ?? "—"} processing ·{" "}
              {snapshot?.mediaQueue.permanentFailures ?? "—"} failed · oldest{" "}
              {duration(snapshot?.mediaQueue.backlogAgeMs)}
            </p>
            {(snapshot?.mediaQueue.permanentFailures ?? 0) > 0 ? (
              <AdminStatus tone="danger" className="mt-2 text-micro">
                {snapshot?.mediaQueue.permanentFailures} permanently failed
              </AdminStatus>
            ) : null}
            {snapshot?.mediaQueue.reason ? (
              <AdminStatus
                tone={snapshot.mediaQueue.available ? "neutral" : "danger"}
                className="mt-2 text-micro"
              >
                {snapshot.mediaQueue.reason}
              </AdminStatus>
            ) : null}
          </article>
        </div>
      </section>

      <dl className="grid gap-2 border-t theme-border pt-5 font-mono text-xs sm:grid-cols-3">
        <div>
          <dt className="theme-faint">environment</dt>
          <dd className="mt-1 break-all">{snapshot?.runtime.environment ?? "—"}</dd>
        </div>
        <div>
          <dt className="theme-faint">version</dt>
          <dd className="mt-1 break-all">{snapshot?.runtime.version ?? "—"}</dd>
        </div>
        <div>
          <dt className="theme-faint">commit</dt>
          <dd className="mt-1 break-all">{snapshot?.runtime.commit ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
