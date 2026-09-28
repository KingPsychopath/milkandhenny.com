"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { WaitlistAdminView, WaitlistStatus } from "@/features/event-waitlist/types";
import { adminWaitlistQuery } from "@/features/event-waitlist/admin-waitlist.queries";
import { AdminStatus, type AdminStatusTone } from "./AdminStatus";

const EMPTY_COUNTS: WaitlistAdminView["counts"] = {
  pending: 0,
  active: 0,
  notified: 0,
  converted: 0,
  left: 0,
  expired: 0,
  undeliverable: 0,
};

function statusTone(status: WaitlistStatus): AdminStatusTone {
  if (status === "active" || status === "converted") return "positive";
  if (status === "pending") return "attention";
  if (status === "undeliverable") return "danger";
  return "neutral";
}

function dateLabel(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unavailable";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EventWaitlistPanel({
  eventSlug,
  onError,
}: {
  eventSlug: string;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const waitlistQuery = useQuery(adminWaitlistQuery(eventSlug));
  const view: WaitlistAdminView = waitlistQuery.data ?? { counts: EMPTY_COUNTS, entries: [] };
  const loading = waitlistQuery.isFetching;

  const load = useCallback(async () => {
    try {
      await queryClient.fetchQuery({ ...adminWaitlistQuery(eventSlug), staleTime: 0 });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load the waitlist");
    }
  }, [queryClient, eventSlug, onError]);

  useEffect(() => {
    if (waitlistQuery.error) onError(waitlistQuery.error.message);
  }, [waitlistQuery.error, onError]);

  return (
    <section aria-labelledby="event-waitlist-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">waitlist</p>
          <h4 id="event-waitlist-heading" className="mt-1 font-serif text-2xl">
            Availability alerts
          </h4>
          <p className="mt-2 max-w-xl font-mono text-micro leading-relaxed theme-muted">
            Confirmed people are notified oldest first, up to the number of newly available places.
            Each person gets one alert and tickets are never silently held.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 px-2 font-mono text-micro underline underline-offset-4 theme-muted hover:text-foreground disabled:opacity-50"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        <div>
          <dt className="font-mono text-micro theme-muted">waiting</dt>
          <dd className="font-mono text-lg">{view.counts.active}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">confirming</dt>
          <dd className="font-mono text-lg">{view.counts.pending}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">alerted</dt>
          <dd className="font-mono text-lg">{view.counts.notified}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">converted</dt>
          <dd className="font-mono text-lg">{view.counts.converted}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro theme-muted">delivery blocked</dt>
          <dd className="font-mono text-lg">{view.counts.undeliverable}</dd>
        </div>
      </dl>

      {waitlistQuery.error && !waitlistQuery.data ? (
        <p role="alert" className="mt-6 font-mono text-xs theme-muted">
          {waitlistQuery.error.message}
        </p>
      ) : loading && view.entries.length === 0 ? (
        <p role="status" className="mt-6 font-mono text-xs theme-muted">
          loading waitlist…
        </p>
      ) : view.entries.length === 0 ? (
        <p className="mt-6 border-y theme-border py-5 font-mono text-xs theme-faint">
          nobody has joined this waitlist yet
        </p>
      ) : (
        <ul className="mt-6 divide-y theme-border border-y theme-border">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-foreground">{entry.email}</p>
                <p className="mt-1 font-mono text-micro theme-muted">
                  {entry.scopeLabel} · joined {dateLabel(entry.createdAt)}
                </p>
                {entry.notifiedAt ? (
                  <p className="mt-1 font-mono text-micro theme-faint">
                    alert queued {dateLabel(entry.notifiedAt)}
                  </p>
                ) : null}
                {entry.convertedAt ? (
                  <p className="mt-1 font-mono text-micro theme-faint">
                    bought {dateLabel(entry.convertedAt)}
                    {entry.convertedOrderId ? ` · order ${entry.convertedOrderId}` : ""}
                    {entry.conversionOrderStatus ? ` · ${entry.conversionOrderStatus}` : ""}
                  </p>
                ) : null}
              </div>
              <AdminStatus tone={statusTone(entry.status)}>{entry.status}</AdminStatus>
            </li>
          ))}
        </ul>
      )}

      {view.entries.length >= 500 ? (
        <p className="mt-2 font-mono text-micro theme-faint">showing the latest 500 entries</p>
      ) : null}
    </section>
  );
}
