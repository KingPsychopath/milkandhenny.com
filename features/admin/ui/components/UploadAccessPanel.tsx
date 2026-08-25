"use client";

import { useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { copyText } from "@/lib/client/share";
import { useActionDialog } from "@/hooks/useActionDialog";
import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";
import type { UploadAccessDurationMinutes } from "@/features/auth/upload-access.server";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type EnsureStepUpToken = () => Promise<string | null>;

type UploadAccessAuditEvent = {
  id: string;
  action: "opened" | "closed";
  at: string;
  durationMinutes?: UploadAccessDurationMinutes;
};

type UploadAccessStatus = {
  active: boolean;
  openedAt?: string;
  expiresAt?: string;
  durationMinutes?: UploadAccessDurationMinutes;
  audit: UploadAccessAuditEvent[];
};

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UploadAccessPanel({
  authFetch,
  ensureStepUpToken,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  ensureStepUpToken: EnsureStepUpToken;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [status, setStatus] = useState<UploadAccessStatus | null>(null);
  const [duration, setDuration] = useState<UploadAccessDurationMinutes>(15);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const { confirm: confirmAction, dialog } = useActionDialog();

  const [pollingHalted, setPollingHalted] = useState(false);

  const load = useCallback(async () => {
    // `loading` starts true and is never re-raised here: the visible
    // "checking…" badge belongs to the first load, not to every 15-second
    // background refresh.
    try {
      const response = await authFetch("/api/admin/upload-access");
      const data = (await response.json().catch(() => ({}))) as Partial<UploadAccessStatus> & {
        error?: string;
      };
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) setPollingHalted(true);
        throw new Error(data.error || "Failed to load upload access");
      }
      setPollingHalted(false);
      setStatus({
        active: data.active === true,
        openedAt: data.openedAt,
        expiresAt: data.expiresAt,
        durationMinutes: data.durationMinutes,
        audit: Array.isArray(data.audit) ? data.audit : [],
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load upload access");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh only while a window is open, pause in hidden tabs, and stop on a
  // 4xx instead of re-asking a refusing endpoint four times a minute.
  useVisibilityReconciler({
    enabled: Boolean(status?.active) && !pollingHalted,
    intervalMs: 15_000,
    identity: "admin-upload-access",
    minimumGapMs: 5_000,
    reconcile: () => load(),
  });

  const open = async () => {
    setBusy(true);
    onError("");
    try {
      const stepUp = await ensureStepUpToken();
      if (!stepUp) return;
      const response = await authFetch("/api/admin/upload-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-step-up": stepUp,
        },
        body: JSON.stringify({ durationMinutes: duration }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to open uploads");
      onStatus(`Uploads open for ${duration} minutes. Tell people to visit /upload.`);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to open uploads");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    const confirmed = await confirmAction({
      eyebrow: "upload access",
      title: "Close guest uploads?",
      description:
        "The normal /upload page will require the passphrase again. Anyone using the temporary access window will stop working immediately.",
      confirmLabel: "close and revoke all",
      intent: "danger",
    });
    if (!confirmed) return;

    setBusy(true);
    onError("");
    try {
      const stepUp = await ensureStepUpToken();
      if (!stepUp) return;
      const response = await authFetch("/api/admin/upload-access", {
        method: "DELETE",
        headers: { "x-admin-step-up": stepUp },
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to close uploads");
      onStatus("Guest upload access closed and revoked.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to close uploads");
    } finally {
      setBusy(false);
    }
  };

  const copyUploadPage = async () => {
    try {
      await copyText(`${window.location.origin}/upload`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onError("Could not copy the upload page");
    }
  };

  return (
    <section aria-labelledby="upload-access-heading" className="border-t theme-border pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            quick sharing
          </p>
          <h2 id="upload-access-heading" className="mt-2 font-serif text-2xl font-semibold">
            Guest upload access
          </h2>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
            Temporarily open the normal /upload page. Guests can create private transfers, but they
            cannot use admin tools or upload words media.
          </p>
        </div>
        <span className="font-mono text-xs theme-muted" role="status">
          {loading ? "checking…" : status?.active ? "open" : "closed"}
        </span>
      </div>

      {status?.active ? (
        <div className="mt-5 border theme-border rounded-md p-4">
          <p className="font-mono text-sm">guest access is open</p>
          <p className="mt-1 font-mono text-xs theme-muted">
            closes {formatDate(status.expiresAt)} · anyone with the normal page can upload
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyUploadPage()}
              className="min-h-10 rounded border theme-border-strong px-3 font-mono text-xs hover:opacity-70"
            >
              {copied ? "copied ✓" : "copy /upload"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void close()}
              className="min-h-10 rounded px-3 font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-50"
            >
              close and revoke all
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="upload-access-duration" className="font-mono text-xs theme-muted">
              open for
            </label>
            <AppSelect
              id="upload-access-duration"
              value={duration}
              onValueChange={(value) => setDuration(Number(value) as UploadAccessDurationMinutes)}
              options={[
                { value: 15, label: "15 minutes" },
                { value: 60, label: "60 minutes" },
              ]}
              tone="theme"
              variant="field"
              ariaLabel="Open uploads for"
              className="mt-2 min-w-44"
            />
          </div>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void open()}
            className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "opening…" : "open uploads"}
          </button>
        </div>
      )}

      {status && status.audit.length > 0 ? (
        <details className="mt-5 border-t theme-border pt-4">
          <summary className="cursor-pointer font-mono text-xs theme-muted">
            access history ({status.audit.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {status.audit.slice(0, 8).map((event) => (
              <li key={`${event.id}-${event.action}`} className="font-mono text-xs theme-muted">
                {event.action === "opened" ? "opened" : "closed"} · {formatDate(event.at)}
                {event.durationMinutes ? ` · ${event.durationMinutes} minutes` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {dialog}
    </section>
  );
}
