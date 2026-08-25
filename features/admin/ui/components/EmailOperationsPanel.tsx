"use client";

import { useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { EmailLedgerPage } from "@/features/email-operations/types";
import { useActionDialog } from "@/hooks/useActionDialog";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "40", sort });
      if (query) params.set("q", query);
      if (channel) params.set("channel", channel);
      if (status) params.set("status", status);
      if (deliveryStatus) params.set("deliveryStatus", deliveryStatus);
      if (kind) params.set("kind", kind);
      if (source) params.set("source", source);
      const response = await authFetch(`/api/admin/email?${params}`);
      if (!response.ok)
        throw new Error(await responseError(response, "Could not load email history"));
      setData((await response.json()) as EmailLedgerPage);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load email history");
    } finally {
      setLoading(false);
    }
  }, [authFetch, channel, deliveryStatus, kind, onError, page, query, sort, source, status]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await post({ action, id });
      onStatus(
        action === "resend"
          ? "A fresh email was queued."
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
    await post(body, withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }));
    return true;
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
          "Only do this after the address owner confirms the bounce or complaint is resolved.",
        confirmLabel: "allow email",
        intent: "danger",
      }))
    )
      return;
    setBusy(recipientHash);
    try {
      if (await stepUpPost({ action: "unsuppress", recipientHash })) {
        onStatus(`${recipientHint ?? "Recipient"} can receive email again.`);
        await load();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove suppression");
    } finally {
      setBusy(null);
    }
  };

  const overview = data?.overview;
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
        {data?.entries.map((entry) => (
          <article key={entry.id} className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-micro theme-muted">
                  {entry.kind.replaceAll("-", " ")} · {entry.channel} · {entry.source}
                </p>
                <h4 className="mt-1 font-serif text-lg">{entry.subject ?? "Subject removed"}</h4>
                <p className="mt-1 font-mono text-xs theme-muted">
                  {entry.recipientHint ?? "recipient no longer available"} ·{" "}
                  {dateTime(entry.createdAt)}
                </p>
              </div>
              <p className="font-mono text-xs font-bold">{stateLabel(entry)}</p>
            </div>
            <details className="mt-3 font-mono text-xs">
              <summary className="min-h-11 cursor-pointer py-3 theme-muted">
                details and controls
              </summary>
              <dl className="grid gap-2 border-t theme-border-faint pt-3 sm:grid-cols-2">
                <div>
                  <dt className="theme-faint">attempts</dt>
                  <dd>{entry.attempts}</dd>
                </div>
                <div>
                  <dt className="theme-faint">next attempt</dt>
                  <dd>{dateTime(entry.nextAttemptAt)}</dd>
                </div>
                <div>
                  <dt className="theme-faint">provider accepted</dt>
                  <dd>{dateTime(entry.acceptedAt)}</dd>
                </div>
                <div>
                  <dt className="theme-faint">confirmed delivered</dt>
                  <dd>{dateTime(entry.deliveredAt)}</dd>
                </div>
                <div>
                  <dt className="theme-faint">order / ticket</dt>
                  <dd>{entry.context.orderId ?? entry.context.ticketId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="theme-faint">ledger expires</dt>
                  <dd>{dateTime(entry.retainUntil)}</dd>
                </div>
              </dl>
              {entry.lastError ? (
                <p className="mt-3 text-[var(--prose-hashtag)]">{entry.lastError}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-4">
                {entry.canRetry ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(entry.id, "retry")}
                    className="min-h-11 underline underline-offset-4 disabled:opacity-50"
                  >
                    retry now
                  </button>
                ) : null}
                {entry.canResend ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(entry.id, "resend")}
                    className="min-h-11 underline underline-offset-4 disabled:opacity-50"
                  >
                    send fresh copy
                  </button>
                ) : null}
                {entry.canCancel ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(entry.id, "cancel")}
                    className="min-h-11 theme-muted underline underline-offset-4 disabled:opacity-50"
                  >
                    cancel
                  </button>
                ) : null}
              </div>
            </details>
          </article>
        ))}
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

      {overview && overview.suppressionCount > 0 ? (
        <section
          aria-labelledby="email-suppressions-heading"
          className="border-t theme-border pt-5"
        >
          <h4 id="email-suppressions-heading" className="font-serif text-xl">
            Delivery blocks
          </h4>
          <p className="mt-1 font-mono text-xs theme-muted">
            Bounce and complaint blocks prevent repeated unwanted delivery. They are tiny hashes and
            remain until reviewed.
          </p>
          <ul className="mt-3 divide-y theme-border-faint">
            {overview.suppressions.map((item) => (
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
                  allow again
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
