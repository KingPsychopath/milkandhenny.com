"use client";

import { Link } from "@tanstack/react-router";

import type { SystemCapabilities } from "@/features/system/capabilities";
import type { AdminDestination } from "./AdminSectionNav";

type ContentSnapshot = {
  blog: {
    totalPosts: number;
    featuredPosts: number;
    postsWithImages: number;
    totalReadingMinutes: number;
    latestPostDate: string | null;
  };
  gallery: {
    totalAlbums: number;
    totalPhotos: number;
    albumsWithoutDescription: number;
    invalidAlbumCount: number;
    latestAlbumDate: string | null;
  };
};

type OperationsSnapshot = SystemCapabilities & {
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
  securityWarnings: string[];
};

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  destination: AdminDestination;
  actionLabel: string;
};

const STALE_QUEUE_MS = 15 * 60_000;

export function getAdminAttentionItems(
  content: ContentSnapshot | null,
  system: OperationsSnapshot | null,
  unresolvedByCategory: Record<string, number> = {},
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const capability of system?.capabilities ?? []) {
    if (capability.status === "available" || capability.status === "disabled") continue;
    if (!capability.required) continue;
    items.push({
      id: `capability:${capability.id}`,
      title: `${capability.label} is ${capability.status}`,
      detail: capability.detail,
      destination: { section: "system" },
      actionLabel: "inspect service health",
    });
  }

  if ((content?.gallery.invalidAlbumCount ?? 0) > 0) {
    items.push({
      id: "content:invalid-albums",
      title: `${content?.gallery.invalidAlbumCount} invalid ${content?.gallery.invalidAlbumCount === 1 ? "album" : "albums"}`,
      detail: "Run the content audit to see the exact validation failures.",
      destination: { section: "content" },
      actionLabel: "open content audit",
    });
  }

  const emailDeliveryIssues = unresolvedByCategory["email-delivery"] ?? 0;
  if (emailDeliveryIssues > 0) {
    items.push({
      id: "email:delivery-attention",
      title: `${emailDeliveryIssues} email delivery ${emailDeliveryIssues === 1 ? "issue needs" : "issues need"} review`,
      detail: "A current delivery block or failed delivery needs an administrator.",
      destination: {
        section: "communications",
        communicationTab: "delivery",
      },
      actionLabel: "review delivery issue",
    });
  }

  if ((system?.emailOutbox.awaitingProviderFeedback ?? 0) > 0) {
    items.push({
      id: "email:delivery-events",
      title: "Email delivery signals are missing",
      detail: `${system?.emailOutbox.awaitingProviderFeedback} provider-accepted message${system?.emailOutbox.awaitingProviderFeedback === 1 ? " has" : "s have"} no delivery event after 15 minutes.`,
      destination: { section: "communications", communicationTab: "delivery" },
      actionLabel: "inspect provider delivery signals",
    });
  }

  const oldestPendingAt = system?.emailOutbox.oldestPendingAt
    ? Date.parse(system.emailOutbox.oldestPendingAt)
    : Number.NaN;
  if (
    (system?.emailOutbox.pending ?? 0) > 0 &&
    Number.isFinite(oldestPendingAt) &&
    Date.now() - oldestPendingAt > STALE_QUEUE_MS
  ) {
    items.push({
      id: "email:stale",
      title: "Email queue is delayed",
      detail: `The oldest of ${system?.emailOutbox.pending} pending messages has waited more than 15 minutes.`,
      destination: {
        section: "communications",
        communicationTab: "delivery",
        emailStatus: "pending",
      },
      actionLabel: "open pending queue",
    });
  }

  if (system?.mediaQueue && !system.mediaQueue.available) {
    items.push({
      id: "media:unavailable",
      title: "Media queue status is unavailable",
      detail: system.mediaQueue.reason ?? "The queue could not be inspected.",
      destination: { section: "transfers" },
      actionLabel: "inspect media queue",
    });
  }

  if ((system?.mediaQueue.permanentFailures ?? 0) > 0) {
    items.push({
      id: "media:failed",
      title: `${system?.mediaQueue?.permanentFailures} media ${system?.mediaQueue?.permanentFailures === 1 ? "job needs" : "jobs need"} attention`,
      detail: "These jobs exhausted automatic retries.",
      destination: { section: "transfers" },
      actionLabel: "review failed media jobs",
    });
  }

  if ((system?.mediaQueue.backlogAgeMs ?? 0) > STALE_QUEUE_MS) {
    items.push({
      id: "media:stale",
      title: "Media processing is delayed",
      detail: `The oldest queued job has waited more than 15 minutes. ${system?.mediaQueue?.queued ?? 0} jobs are queued.`,
      destination: { section: "transfers" },
      actionLabel: "open media backlog",
    });
  }

  for (const [index, warning] of (system?.securityWarnings ?? []).entries()) {
    items.push({
      id: `security:${index}:${warning}`,
      title: "Security configuration needs attention",
      detail: warning,
      destination: { section: "system" },
      actionLabel: "review security configuration",
    });
  }

  return items;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function formatCheckedAt(value: string | undefined): string {
  if (!value) return "not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not checked";
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

export function AdminOverviewPanel({
  content,
  system,
  loading,
  unresolvedByCategory,
  onRefresh,
  onNavigate,
}: {
  content: ContentSnapshot | null;
  system: OperationsSnapshot | null;
  loading: boolean;
  unresolvedByCategory: Record<string, number>;
  onRefresh: () => void;
  onNavigate: (destination: AdminDestination) => void;
}) {
  const attention = getAdminAttentionItems(content, system, unresolvedByCategory);
  const status = system?.status ?? "checking";

  return (
    <div className="space-y-6">
      <section aria-labelledby="control-room-heading" className="border-y theme-border py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              control room
            </p>
            <h2 id="control-room-heading" className="mt-2 font-serif text-3xl font-semibold">
              {attention.length > 0
                ? `${attention.length} ${attention.length === 1 ? "item" : "items"} to review`
                : "Everything looks clear"}
            </h2>
            <p className="mt-2 font-mono text-xs theme-muted">
              System {status} · checked {formatCheckedAt(system?.timestamp)}
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="min-h-11 shrink-0 font-mono text-xs theme-muted transition-opacity hover:opacity-70 disabled:opacity-50"
            aria-label="Refresh control room status"
          >
            {loading ? "checking..." : "refresh"}
          </button>
        </div>

        {attention.length > 0 ? (
          <ol className="mt-5 space-y-2">
            {attention.map((item) => (
              <li key={item.id} className="border-t theme-border pt-3 first:border-t-0 first:pt-0">
                <button
                  type="button"
                  onClick={() => onNavigate(item.destination)}
                  className="group w-full min-h-11 text-left"
                >
                  <span className="font-mono text-sm text-[var(--prose-hashtag)]">
                    {item.title}
                  </span>
                  <span className="mt-1 block font-mono text-xs leading-relaxed theme-muted">
                    {item.detail}
                  </span>
                  <span className="mt-1 block font-mono text-micro theme-faint transition-opacity group-hover:opacity-70">
                    {item.actionLabel} →
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : system ? (
          <p className="mt-5 font-mono text-xs leading-relaxed theme-muted">
            Required services responded, delivery queues are moving, and no content or security
            warnings need action.
          </p>
        ) : (
          <p className="mt-5 font-mono text-xs theme-muted" role="status">
            Checking services and queues…
          </p>
        )}
      </section>

      <section aria-labelledby="common-actions-heading">
        <h2 id="common-actions-heading" className="font-mono text-sm font-bold">
          common actions
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Link
            to="/admin/editor"
            search={{ slug: undefined }}
            className="min-h-24 border-y theme-border px-1 py-4 transition-opacity hover:opacity-70"
          >
            <span className="font-mono text-xs font-bold">write or edit</span>
            <span className="mt-2 block font-mono text-micro theme-muted">
              words, media, and sharing
            </span>
          </Link>
          <button
            type="button"
            onClick={() => onNavigate({ section: "events" })}
            className="min-h-24 border-y theme-border px-1 py-4 text-left transition-opacity hover:opacity-70"
          >
            <span className="font-mono text-xs font-bold">run an event</span>
            <span className="mt-2 block font-mono text-micro theme-muted">
              tickets, scanners, and pitches
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate({ section: "transfers" })}
            className="min-h-24 border-y theme-border px-1 py-4 text-left transition-opacity hover:opacity-70"
          >
            <span className="font-mono text-xs font-bold">manage transfers</span>
            <span className="mt-2 block font-mono text-micro theme-muted">
              drops and media processing
            </span>
          </button>
        </div>
      </section>

      <section aria-labelledby="site-snapshot-heading">
        <h2 id="site-snapshot-heading" className="font-mono text-sm font-bold">
          site snapshot
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-3">
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">words</dt>
            <dd className="text-lg">{content?.blog.totalPosts ?? "—"}</dd>
          </div>
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">albums</dt>
            <dd className="text-lg">{content?.gallery.totalAlbums ?? "—"}</dd>
          </div>
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">photos</dt>
            <dd className="text-lg">{content?.gallery.totalPhotos ?? "—"}</dd>
          </div>
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">latest word</dt>
            <dd>{formatDate(content?.blog.latestPostDate)}</dd>
          </div>
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">latest album</dt>
            <dd>{formatDate(content?.gallery.latestAlbumDate)}</dd>
          </div>
          <div className="rounded-md border theme-border p-3">
            <dt className="theme-muted text-xs">hero images</dt>
            <dd className="text-lg">{content?.blog.postsWithImages ?? "—"}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => onNavigate({ section: "content" })}
          className="mt-3 min-h-11 font-mono text-xs theme-muted transition-opacity hover:opacity-70"
        >
          open full content detail
        </button>
      </section>
    </div>
  );
}
