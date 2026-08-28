"use client";

import { useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { EmailLedgerPage } from "@/features/email-operations/types";
import { useActionDialog } from "@/hooks/useActionDialog";
import {
  ADMIN_ACTIVE_REFRESH_WINDOW_MS,
  useAdminAutoRefresh,
} from "@/features/admin/ui/hooks/useAdminAutoRefresh";
import {
  EMAIL_CHANNELS,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_KINDS,
  EMAIL_OUTBOX_STATUSES,
  EMAIL_SOURCES,
} from "@/lib/shared/email-operations";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type StepUpResult = { ok: true; token: string } | { ok: false; cancelled?: true; error?: string };

async function responseError(response: Response, fallback: string): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

function dateTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}

function stateLabel(entry: EmailLedgerPage["entries"][number]): string {
  if (entry.deliveryStatus) return entry.deliveryStatus;
  if (entry.status === "accepted") return "provider accepted";
  if (entry.status === "processing") return "sending";
  return entry.status;
}

function hasRecentUnsettledEmail(
  entry: EmailLedgerPage["entries"][number],
  deliveryEventsConfigured: boolean,
  now = Date.now(),
): boolean {
  const updatedAt = Date.parse(entry.updatedAt);
  if (Number.isNaN(updatedAt) || now - updatedAt > ADMIN_ACTIVE_REFRESH_WINDOW_MS) return false;
  if (entry.status === "pending" || entry.status === "processing") return true;
  return (
    deliveryEventsConfigured &&
    entry.status === "accepted" &&
    (entry.deliveryStatus === null || entry.deliveryStatus === "deferred")
  );
}

type LedgerEntry = EmailLedgerPage["entries"][number];

function deliveryThreadKey(entry: LedgerEntry): string {
  if (
    entry.channel === "tickets" &&
    (entry.kind === "ticket-issued" || entry.kind === "ticket-resend") &&
    entry.context.orderId
  ) {
    return `ticket-order:${entry.context.orderId}`;
  }
  return entry.id;
}

function groupDeliveryThreads(entries: LedgerEntry[]): LedgerEntry[][] {
  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const key = deliveryThreadKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((group) =>
    group.toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  );
}

export function EmailOperationsPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
  initialStatus,
  initialQuery,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<StepUpResult>;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
  initialStatus?: string;
  initialQuery?: string;
}) {
  const [data, setData] = useState<EmailLedgerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftQuery, setDraftQuery] = useState(initialQuery ?? "");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState(
    initialStatus && EMAIL_OUTBOX_STATUSES.includes(initialStatus as never) ? initialStatus : "",
  );
  const [deliveryStatus, setDeliveryStatus] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [pollingHalted, setPollingHalted] = useState(false);
  const [recoveryEmails, setRecoveryEmails] = useState<Record<string, string>>({});
  const { confirm, dialog } = useActionDialog();

  useEffect(() => {
    setStatus(
      initialStatus && EMAIL_OUTBOX_STATUSES.includes(initialStatus as never) ? initialStatus : "",
    );
    setPage(1);
  }, [initialStatus]);

  useEffect(() => {
    setDraftQuery(initialQuery ?? "");
    setQuery(initialQuery ?? "");
    setPage(1);
  }, [initialQuery]);

  const load = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "40", sort });
        if (query) params.set("q", query);
        if (channel) params.set("channel", channel);
        if (status) params.set("status", status);
        if (deliveryStatus) params.set("deliveryStatus", deliveryStatus);
        if (kind) params.set("kind", kind);
        if (source) params.set("source", source);
        const response = await authFetch(`/api/admin/email?${params}`);
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) setPollingHalted(true);
          throw new Error(await responseError(response, "Could not load email history"));
        }
        setPollingHalted(false);
        setData((await response.json()) as EmailLedgerPage);
      } catch (error) {
        if (!background) {
          onError(error instanceof Error ? error.message : "Could not load email history");
        }
      } finally {
        if (!background) setLoading(false);
      }
    },
    [authFetch, channel, deliveryStatus, kind, onError, page, query, sort, source, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const deliveryIsActive = Boolean(
    data?.entries.some((entry) =>
      hasRecentUnsettledEmail(entry, data.overview.deliveryEventsConfigured),
    ),
  );
  useAdminAutoRefresh({
    enabled: deliveryIsActive && !pollingHalted,
    cadence: "active",
    identity: `admin-email:${page}:${query}:${channel}:${status}:${deliveryStatus}:${kind}:${source}:${sort}`,
    refreshOnEnable: false,
    refresh: () => load(true),
  });

  const post = async (
    body: Record<string, unknown>,
    headers: Record<string, string> = { "Content-Type": "application/json" },
  ) => {
    const response = await authFetch("/api/admin/email", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response, "Email action failed"));
    return (await response.json()) as Record<string, unknown>;
  };

  const act = async (id: string, action: "retry" | "cancel" | "resend") => {
    const wording =
      action === "resend"
        ? "Regenerate and send this email again?"
        : action === "cancel"
          ? "Cancel this queued email?"
          : null;
    if (
      wording &&
      !(await confirm({
        eyebrow: "email delivery",
        title: wording,
        description:
          action === "resend"
            ? "A fresh message will be built from the current ticket or refund record."
            : "The retained message content will be removed immediately.",
        confirmLabel: action,
        intent: action === "cancel" ? "danger" : "default",
      }))
    )
      return;
    setBusy(id);
    onError("");
    try {
      const result = await post({ action, id });
      onStatus(
        action === "resend"
          ? result.alreadyRequested
            ? "A ticket resend was already requested recently · no duplicate was queued."
            : "One fresh ticket email was queued · delivery status will update here."
          : action === "retry"
            ? "The queued email was attempted now."
            : "The queued email was cancelled and its content removed.",
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Email action failed");
    } finally {
      setBusy(null);
    }
  };

  const drain = async () => {
    setBusy("drain");
    try {
      const result = await post({ action: "drain" });
      onStatus(`Email queue checked · ${Number(result.handled ?? 0)} handled.`);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not drain the email queue");
    } finally {
      setBusy(null);
    }
  };

  const stepUpPost = async (body: Record<string, unknown>) => {
    const stepUp = await ensureStepUpToken();
    if (!stepUp.ok) {
      if (!stepUp.cancelled) onError(stepUp.error ?? "Step-up failed");
      return false;
    }
    return post(body, withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }));
  };

  const cleanup = async () => {
    if (
      !(await confirm({
        eyebrow: "email retention",
        title: "Apply the retention policy now?",
        description: "Expired delivery events and ledger metadata will be permanently removed.",
        confirmLabel: "clean up",
        intent: "danger",
      }))
    )
      return;
    setBusy("cleanup");
    try {
      if (await stepUpPost({ action: "cleanup" })) {
        onStatus("Email retention cleanup finished.");
        await load();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Email cleanup failed");
    } finally {
      setBusy(null);
    }
  };

  const unsuppress = async (recipientHash: string, recipientHint: string | null) => {
    if (
      !(await confirm({
        eyebrow: "delivery safety",
        title: `Allow ${recipientHint ?? "this recipient"} again?`,
        description:
          "This only removes the delivery block. It does not send an email. Only continue after the address owner confirms the bounce or complaint is resolved.",
        confirmLabel: "remove block only",
        intent: "danger",
      }))
    )
      return;
    setBusy(recipientHash);
    try {
      if (await stepUpPost({ action: "unsuppress", recipientHash })) {
        onStatus(`${recipientHint ?? "Recipient"} is unblocked · no email was sent.`);
        await load();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove suppression");
    } finally {
      setBusy(null);
    }
  };

  const recoverTicketDelivery = async (entry: LedgerEntry) => {
    const suppression = entry.suppression;
    const recipientEmail = suppression
      ? (recoveryEmails[suppression.recipientHash] ?? "").trim()
      : "";
    if (!suppression || !recipientEmail) {
      onError("Enter the corrected recipient email");
      return;
    }
    if (
      !(await confirm({
        eyebrow: "bounced ticket email",
        title: `Correct the address and send one fresh copy?`,
        description: `The matching address on this ticket order will become ${recipientEmail}. The old bounce block will be removed, then one fresh ticket email will be queued.`,
        confirmLabel: "correct and queue one",
        intent: "danger",
      }))
    )
      return;
    setBusy(entry.id);
    onError("");
    try {
      const result = await stepUpPost({
        action: "correct-and-resend",
        id: entry.id,
        recipientEmail,
      });
      if (result) {
        onStatus(
          result.alreadyRequested
            ? `Address corrected and old block removed · a recent resend already exists, so no duplicate was queued.`
            : `Address corrected and old block removed · one fresh ticket email was queued.`,
        );
        setRecoveryEmails((current) => {
          const next = { ...current };
          delete next[suppression.recipientHash];
          return next;
        });
        await load();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not recover ticket delivery");
    } finally {
      setBusy(null);
    }
  };

  const overview = data?.overview;
  const deliveryThreads = groupDeliveryThreads(data?.entries ?? []);
  const visibleSuppressionHashes = new Set(
    data?.entries.flatMap((entry) =>
      entry.suppression ? [entry.suppression.recipientHash] : [],
    ) ?? [],
  );
  const otherSuppressions =
    overview?.suppressions.filter(
      (suppression) => !visibleSuppressionHashes.has(suppression.recipientHash),
    ) ?? [];
  return (
    <section aria-labelledby="email-operations-heading" className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            transactional email
          </p>
          <h3 id="email-operations-heading" className="mt-2 font-serif text-3xl tracking-tight">
            Delivery history
          </h3>
          <p className="mt-2 max-w-2xl font-serif leading-relaxed theme-muted">
            Search ticket, refund, exchange, studio and campaign email in one place. Recipient
            addresses are masked here; an exact address search is matched by its private hash.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={loading || busy !== null}
            onClick={() => void load()}
            className="min-h-11 px-2 font-mono text-xs underline underline-offset-4 transition-opacity hover:opacity-70 disabled:opacity-50"
          >
            {loading ? "refreshing…" : "refresh delivery"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void drain()}
            className="min-h-11 px-2 font-mono text-xs underline underline-offset-4 transition-opacity hover:opacity-70 disabled:opacity-50"
          >
            check queue
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void cleanup()}
            className="min-h-11 px-2 font-mono text-xs theme-muted underline underline-offset-4 transition-opacity hover:opacity-70 disabled:opacity-50"
          >
            clean up now
          </button>
        </div>
      </div>

      <p className="font-mono text-micro theme-faint" role="status">
        {pollingHalted
          ? "automatic delivery updates paused after an access error · use refresh delivery"
          : deliveryIsActive
            ? "delivery status updates automatically while recent messages settle"
            : "automatic updates pause after delivery settles or 15 minutes · manual refresh remains available"}
      </p>

      {overview ? (
        <>
          <dl className="grid gap-3 border-y theme-border py-5 font-mono text-xs sm:grid-cols-4">
            <div>
              <dt className="theme-faint">queued</dt>
              <dd className="mt-1 text-lg">
                {overview.counts.pending + overview.counts.processing}
              </dd>
            </div>
            <div>
              <dt className="theme-faint">provider accepted</dt>
              <dd className="mt-1 text-lg">{overview.counts.accepted}</dd>
            </div>
            <div>
              <dt className="theme-faint">confirmed delivered</dt>
              <dd className="mt-1 text-lg">{overview.delivered}</dd>
            </div>
            <div>
              <dt className="theme-faint">failed</dt>
              <dd className="mt-1 text-lg">{overview.counts.failed}</dd>
            </div>
          </dl>
          <div
            className={`border-l-2 pl-4 font-mono text-xs leading-relaxed ${overview.feedbackHealth === "stale" ? "border-[var(--prose-hashtag)]" : "theme-border"}`}
          >
            <p className="font-bold">Delivery signals: {overview.feedbackHealth}</p>
            <p className="mt-1 theme-muted">
              {overview.feedbackHealth === "stale"
                ? `${overview.awaitingProviderFeedback} provider-accepted message${overview.awaitingProviderFeedback === 1 ? " has" : "s have"} no delivery event after 15 minutes. Check the provider event relay.`
                : overview.feedbackHealth === "disabled"
                  ? "Provider delivery events are not configured. Accepted means handed to the provider, not inbox delivery."
                  : `Latest provider event ${dateTime(overview.latestDeliveryEventAt)}.`}
            </p>
            <p className="mt-2 theme-faint">
              Message content: {overview.policy.queueContentDays} days maximum · delivery events:{" "}
              {overview.policy.deliveryEventDays} days · ledger metadata:{" "}
              {overview.policy.ledgerDays} days · suppression hashes stay until reviewed.
            </p>
          </div>
        </>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(draftQuery.trim());
        }}
        className="grid gap-3 border-t theme-border pt-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="font-mono text-xs sm:col-span-2">
          <span className="theme-muted">search</span>
          <input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="email, order, subject"
            className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
        </label>
        <div className="font-mono text-xs">
          <span className="theme-muted">channel</span>
          <AppSelect
            ariaLabel="Filter by channel"
            value={channel}
            onValueChange={(value) => {
              setPage(1);
              setChannel(value);
            }}
            options={[
              { value: "", label: "all channels" },
              ...EMAIL_CHANNELS.map((value) => ({ value, label: value })),
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <div className="font-mono text-xs">
          <span className="theme-muted">delivery</span>
          <AppSelect
            ariaLabel="Filter by delivery result"
            value={deliveryStatus}
            onValueChange={(value) => {
              setPage(1);
              setDeliveryStatus(value);
            }}
            options={[
              { value: "", label: "all delivery results" },
              ...EMAIL_DELIVERY_STATUSES.map((value) => ({
                value,
                label: value.replaceAll("-", " "),
              })),
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <div className="font-mono text-xs">
          <span className="theme-muted">state</span>
          <AppSelect
            ariaLabel="Filter by state"
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            options={[
              { value: "", label: "all states" },
              ...EMAIL_OUTBOX_STATUSES.map((value) => ({ value, label: value })),
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <div className="font-mono text-xs">
          <span className="theme-muted">source</span>
          <AppSelect
            ariaLabel="Filter by email source"
            value={source}
            onValueChange={(value) => {
              setPage(1);
              setSource(value);
            }}
            options={[
              { value: "", label: "all sources" },
              ...EMAIL_SOURCES.map((value) => ({
                value,
                label: value.replaceAll("-", " "),
              })),
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <div className="font-mono text-xs">
          <span className="theme-muted">purpose</span>
          <AppSelect
            ariaLabel="Filter by purpose"
            value={kind}
            onValueChange={(value) => {
              setPage(1);
              setKind(value);
            }}
            options={[
              { value: "", label: "all purposes" },
              ...EMAIL_KINDS.map((value) => ({ value, label: value.replaceAll("-", " ") })),
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <div className="font-mono text-xs">
          <span className="theme-muted">sort</span>
          <AppSelect
            ariaLabel="Sort email history"
            value={sort}
            onValueChange={(value) => {
              setPage(1);
              setSort(value);
            }}
            options={[
              { value: "newest", label: "newest first" },
              { value: "oldest", label: "oldest first" },
              { value: "next-attempt", label: "next attempt" },
            ]}
            variant="field"
            className="mt-1"
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded border theme-border-strong px-4 font-mono text-xs sm:col-span-2"
        >
          search
        </button>
      </form>

      <div aria-busy={loading} className="divide-y theme-border">
        {deliveryThreads.map((thread) => {
          const entry = thread[0];
          if (!entry) return null;
          const suppression = thread.find((attempt) => attempt.suppression)?.suppression ?? null;
          const recoveryEntry = thread.find(
            (attempt) =>
              attempt.suppression?.reason === "bounced" &&
              attempt.canResend &&
              (attempt.kind === "ticket-issued" || attempt.kind === "ticket-resend"),
          );
          return (
            <article key={deliveryThreadKey(entry)} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-micro theme-muted">
                    {entry.channel === "tickets" && thread.length > 1
                      ? `ticket delivery · ${thread.length} attempts`
                      : `${entry.kind.replaceAll("-", " ")} · ${entry.channel} · ${entry.source}`}
                  </p>
                  <h4 className="mt-1 font-serif text-lg">{entry.subject ?? "Subject removed"}</h4>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {entry.recipientHint ?? "recipient no longer available"} · latest{" "}
                    {dateTime(entry.createdAt)}
                  </p>
                </div>
                <p className="font-mono text-xs font-bold">{stateLabel(entry)}</p>
              </div>

              {suppression ? (
                <div className="mt-4 border-l-2 border-[var(--prose-hashtag)] pl-4 font-mono text-xs">
                  <p className="font-bold">
                    Delivery blocked after{" "}
                    {suppression.reason === "bounced" ? "a bounce" : "a complaint"}
                  </p>
                  <p className="mt-1 theme-muted">
                    {suppression.recipientHint ?? "This recipient"} will not be emailed again until
                    this block is resolved. Removing a block alone never sends mail.
                  </p>
                  {recoveryEntry ? (
                    <form
                      className="mt-3 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void recoverTicketDelivery(recoveryEntry);
                      }}
                    >
                      <label className="min-w-0 flex-1">
                        <span className="theme-muted">correct recipient address</span>
                        <input
                          type="email"
                          required
                          autoComplete="off"
                          value={recoveryEmails[suppression.recipientHash] ?? ""}
                          onChange={(event) =>
                            setRecoveryEmails((current) => ({
                              ...current,
                              [suppression.recipientHash]: event.target.value,
                            }))
                          }
                          placeholder="name@example.com"
                          className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy !== null}
                        className="min-h-11 rounded border theme-border-strong px-4 font-bold disabled:opacity-50"
                      >
                        correct + queue one copy
                      </button>
                    </form>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void unsuppress(suppression.recipientHash, suppression.recipientHint)
                      }
                      className="min-h-11 theme-muted underline underline-offset-4 disabled:opacity-50"
                    >
                      remove block only — do not send
                    </button>
                    {recoveryEntry ? (
                      <span className="theme-faint">
                        repeat requests are deduplicated for 5 minutes
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <details className="mt-3 font-mono text-xs">
                <summary className="min-h-11 cursor-pointer py-3 theme-muted">
                  {thread.length === 1
                    ? "delivery details and controls"
                    : `${thread.length} delivery attempts and controls`}
                </summary>
                <div className="divide-y theme-border-faint border-t theme-border-faint">
                  {thread.map((attempt) => (
                    <div key={attempt.id} className="py-4 first:pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="theme-muted">
                          {attempt.kind.replaceAll("-", " ")} · {dateTime(attempt.createdAt)}
                        </p>
                        <p className="font-bold">{stateLabel(attempt)}</p>
                      </div>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="theme-faint">provider attempts</dt>
                          <dd>{attempt.attempts}</dd>
                        </div>
                        <div>
                          <dt className="theme-faint">next attempt</dt>
                          <dd>
                            {attempt.status === "pending" ? dateTime(attempt.nextAttemptAt) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="theme-faint">provider accepted</dt>
                          <dd>{dateTime(attempt.acceptedAt)}</dd>
                        </div>
                        <div>
                          <dt className="theme-faint">confirmed delivered</dt>
                          <dd>{dateTime(attempt.deliveredAt)}</dd>
                        </div>
                        <div>
                          <dt className="theme-faint">order / ticket</dt>
                          <dd>{attempt.context.orderId ?? attempt.context.ticketId ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="theme-faint">ledger expires</dt>
                          <dd>{dateTime(attempt.retainUntil)}</dd>
                        </div>
                      </dl>
                      {attempt.lastError ? (
                        <p className="mt-3 text-[var(--prose-hashtag)]">{attempt.lastError}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-4">
                        {attempt.canRetry ? (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void act(attempt.id, "retry")}
                            className="min-h-11 underline underline-offset-4 disabled:opacity-50"
                          >
                            retry queued attempt now
                          </button>
                        ) : null}
                        {attempt.canResend && !attempt.suppression ? (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void act(attempt.id, "resend")}
                            className="min-h-11 underline underline-offset-4 disabled:opacity-50"
                          >
                            queue one fresh copy
                          </button>
                        ) : null}
                        {attempt.canCancel ? (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void act(attempt.id, "cancel")}
                            className="min-h-11 theme-muted underline underline-offset-4 disabled:opacity-50"
                          >
                            cancel queued attempt
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
        {!loading && data?.entries.length === 0 ? (
          <p className="py-8 font-mono text-xs theme-muted">No email matches these filters.</p>
        ) : null}
        {loading ? (
          <p className="py-8 font-mono text-xs theme-muted">loading email history…</p>
        ) : null}
      </div>

      {data && data.pages > 1 ? (
        <nav
          aria-label="Email history pages"
          className="flex items-center justify-between border-t theme-border pt-4 font-mono text-xs"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="min-h-11 px-2 underline underline-offset-4 disabled:opacity-30"
          >
            previous
          </button>
          <p>
            page {data.page} of {data.pages} · {data.total} messages
          </p>
          <button
            type="button"
            disabled={page >= data.pages}
            onClick={() => setPage((value) => value + 1)}
            className="min-h-11 px-2 underline underline-offset-4 disabled:opacity-30"
          >
            next
          </button>
        </nav>
      ) : null}

      {overview && otherSuppressions.length > 0 ? (
        <section
          aria-labelledby="email-suppressions-heading"
          className="border-t theme-border pt-5"
        >
          <h4 id="email-suppressions-heading" className="font-serif text-xl">
            Other delivery blocks
          </h4>
          <p className="mt-1 font-mono text-xs theme-muted">
            Bounce and complaint blocks prevent repeated unwanted delivery. They are tiny hashes and
            remain until reviewed.
          </p>
          <ul className="mt-3 divide-y theme-border-faint">
            {otherSuppressions.map((item) => (
              <li
                key={item.recipientHash}
                className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-xs"
              >
                <span>
                  {item.recipientHint ?? "masked recipient"} · {item.reason} ·{" "}
                  {dateTime(item.lastOccurredAt)}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void unsuppress(item.recipientHash, item.recipientHint)}
                  className="min-h-11 px-2 underline underline-offset-4 disabled:opacity-50"
                >
                  remove block only — do not send
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {dialog}
    </section>
  );
}
