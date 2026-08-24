"use client";

import type { SystemCapabilities } from "@/features/system/capabilities";

type SystemHealthSnapshot = SystemCapabilities & {
  emailOutbox: {
    available: boolean;
    pending: number;
    processing: number;
    accepted: number;
    failed: number;
    oldestPendingAt: string | null;
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
  return (
    <div id="system-health" className="border-t theme-border pt-6 space-y-6 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs theme-muted">system health</p>
          <p className="mt-1 font-serif text-2xl font-semibold">
            {snapshot ? snapshot.status : "Not checked"}
          </p>
          <p className="mt-1 font-mono text-micro theme-faint">
            checked {checkedAt(snapshot?.timestamp)}
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
            <div className="flex items-start justify-between gap-3 font-mono">
              <p className="text-xs theme-muted">{capability.label}</p>
              <p
                className={`text-micro ${
                  capability.status === "available" || capability.status === "disabled"
                    ? "theme-faint"
                    : "text-[var(--prose-hashtag)]"
                }`}
              >
                {capability.status}
              </p>
            </div>
            <p className="mt-2 font-mono text-xs leading-relaxed">{capability.detail}</p>
            <p className="mt-2 font-mono text-micro theme-faint">
              {capability.required ? "required" : "optional"}
              {typeof capability.latencyMs === "number" ? ` · ${capability.latencyMs}ms` : ""}
            </p>
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
              <p className="text-micro theme-faint">
                {snapshot?.emailOutbox.available ? "available" : "unavailable"}
              </p>
            </div>
            <p className="mt-2 text-lg">
              {snapshot ? snapshot.emailOutbox.pending + snapshot.emailOutbox.processing : "—"}{" "}
              active
            </p>
            <p className="mt-1 text-micro theme-faint">
              {snapshot?.emailOutbox.pending ?? "—"} pending ·{" "}
              {snapshot?.emailOutbox.processing ?? "—"} sending ·{" "}
              {snapshot?.emailOutbox.failed ?? "—"} failed
            </p>
          </article>
          <article className="rounded-md border theme-border p-3 font-mono">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs theme-muted">media processing</p>
              <p className="text-micro theme-faint">
                {!snapshot
                  ? "not checked"
                  : !snapshot.mediaQueue.available
                    ? "unavailable"
                    : snapshot.mediaQueue.enabled
                      ? "available"
                      : "disabled"}
              </p>
            </div>
            <p className="mt-2 text-lg">{snapshot?.mediaQueue.queued ?? "—"} queued</p>
            <p className="mt-1 text-micro theme-faint">
              {snapshot?.mediaQueue.leased ?? "—"} processing ·{" "}
              {snapshot?.mediaQueue.permanentFailures ?? "—"} failed · oldest{" "}
              {duration(snapshot?.mediaQueue.backlogAgeMs)}
            </p>
            {snapshot?.mediaQueue.reason ? (
              <p className="mt-2 text-micro text-[var(--prose-hashtag)]">
                {snapshot.mediaQueue.reason}
              </p>
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
