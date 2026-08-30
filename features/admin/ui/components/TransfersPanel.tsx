"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { buildTransferUrl } from "@/features/transfers/routes";
import { copyText } from "@/lib/client/share";
import { useActionDialog } from "@/hooks/useActionDialog";
import { formatRemaining } from "../format";
import { UploadAccessPanel } from "./UploadAccessPanel";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type EnsureStepUpToken = () => Promise<string | null>;
type StepUpHeaders = (token: string, extra?: Record<string, string>) => Record<string, string>;

type TransferSummary = {
  id: string;
  title: string;
  fileCount: number;
  createdAt: string;
  expiresAt: string;
  remainingSeconds: number;
};

type TransferMediaAdminStats = {
  queueLength: number;
  worker: {
    lastHeartbeatAt?: string;
    lastProcessedAt?: string;
    lastErrorAt?: string;
    lastErrorMessage?: string;
  };
};

type AdminTransferDetail = {
  id: string;
  title: string;
  files: Array<{
    id: string;
    filename: string;
    kind: string;
    mimeType: string;
    previewStatus?: string;
    processingStatus?: string;
    processingBackend?: string;
    processingRoute?: string;
    previewSource?: string;
    convertedFrom?: string;
    processingErrorCode?: string;
    processingErrorDetail?: string;
  }>;
};

type TransferHealthFilter = "all" | "queued" | "processing" | "failed" | "worker";

type TransferListResponse = {
  error?: string;
  transfers?: TransferSummary[];
  media?: TransferMediaAdminStats;
};

type MediaActionResponse = {
  error?: string;
  workerDisabled?: boolean;
  queueLength?: number;
  processedJobs?: number;
  succeeded?: number;
  failed?: number;
  requeued?: boolean;
  processingStatus?: string;
};

type TransferDetailResponse = {
  error?: string;
  transfer?: AdminTransferDetail;
};

type TransferCleanupResponse = {
  error?: string;
  deletedObjects?: number;
  scannedPrefixes?: number;
  expiredIndexEntries?: number;
  deletedTransfers?: number;
  deletedFiles?: number;
};

function transferFileMatchesHealthFilter(
  file: AdminTransferDetail["files"][number],
  filter: TransferHealthFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "worker") return file.processingBackend === "worker";
  return file.processingStatus === filter;
}

export function TransfersPanel({
  authFetch,
  ensureStepUpToken,
  withStepUpHeaders,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  ensureStepUpToken: EnsureStepUpToken;
  withStepUpHeaders: StepUpHeaders;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [transfers, setTransfers] = useState<TransferSummary[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transfersLoadError, setTransfersLoadError] = useState<string | null>(null);
  const [transferMediaStats, setTransferMediaStats] = useState<TransferMediaAdminStats | null>(
    null,
  );
  const [transferDetail, setTransferDetail] = useState<AdminTransferDetail | null>(null);
  const [transferDetailLoading, setTransferDetailLoading] = useState<string | null>(null);
  const [transferDetailError, setTransferDetailError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [transferQuery, setTransferQuery] = useState("");
  const [transferHealthFilter, setTransferHealthFilter] = useState<TransferHealthFilter>("all");
  const [showAllTransfers, setShowAllTransfers] = useState(false);
  const [transferActionLoading, setTransferActionLoading] = useState<string | null>(null);
  const [transferCleanupLoading, setTransferCleanupLoading] = useState(false);
  const [transferDeepCleanupLoading, setTransferDeepCleanupLoading] = useState(false);
  const [transferNukeLoading, setTransferNukeLoading] = useState(false);
  const [transferStatusMessage, setTransferStatusMessage] = useState("");
  const [copiedTransferId, setCopiedTransferId] = useState<string | null>(null);

  const transfersSectionRef = useRef<HTMLDivElement | null>(null);
  const transferDetailRef = useRef<HTMLDivElement | null>(null);
  const transferStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTransferStatus = useCallback((msg: string) => {
    setTransferStatusMessage(msg);
    if (transferStatusTimeoutRef.current) {
      clearTimeout(transferStatusTimeoutRef.current);
    }
    transferStatusTimeoutRef.current = setTimeout(() => setTransferStatusMessage(""), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (transferStatusTimeoutRef.current) clearTimeout(transferStatusTimeoutRef.current);
    };
  }, []);

  const loadTransfers = useCallback(async () => {
    setTransfersLoading(true);
    setTransfersLoadError(null);
    onError("");
    try {
      const res = await authFetch("/api/admin/transfers");
      const data = (await res.json().catch(() => ({}))) as TransferListResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load transfers");
      }
      setTransfers((data.transfers as TransferSummary[]) ?? []);
      setTransferMediaStats((data.media as TransferMediaAdminStats) ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load transfers";
      setTransfersLoadError(msg);
      onError(msg);
    } finally {
      setTransfersLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const loadTransfersAndScroll = useCallback(async () => {
    // Jump immediately so the user sees progress/spinners in the section.
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await loadTransfers();
  }, [loadTransfers]);

  const copyTransferUrl = async (transferId: string) => {
    try {
      const url = buildTransferUrl(window.location.origin, transferId);
      await copyText(url);
      setCopiedTransferId(transferId);
      setTransferStatus("Transfer URL copied.");
      setTimeout(() => {
        setCopiedTransferId((current) => (current === transferId ? null : current));
      }, 1800);
    } catch {
      onError("Clipboard write failed");
    }
  };

  const handleLoadTransferDetail = async (id: string) => {
    setTransferDetailLoading(id);
    setTransferDetail(null);
    setTransferDetailError(null);
    setTransferHealthFilter("all");
    onError("");
    try {
      const res = await authFetch(`/api/admin/transfers/${encodeURIComponent(id)}`);
      const data = (await res.json().catch(() => ({}))) as TransferDetailResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load transfer");
      }
      setTransferDetail((data.transfer as AdminTransferDetail) ?? null);
      requestAnimationFrame(() => {
        transferDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load transfer";
      setTransferDetailError({ id, message: msg });
      requestAnimationFrame(() => {
        transferDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      onError(msg);
    } finally {
      setTransferDetailLoading(null);
    }
  };

  const handleDeleteTransfer = async (id: string, title: string) => {
    if (
      !(await confirmAction({
        eyebrow: "transfer manager",
        title: `Delete “${title}”?`,
        description: `This permanently removes transfer ${id}, its metadata, and every stored file.`,
        confirmLabel: "delete transfer",
        intent: "danger",
      }))
    ) {
      return;
    }
    setTransferActionLoading(id);
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch(`/api/admin/transfers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: withStepUpHeaders(stepToken),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to delete transfer");
      }
      const msg = `Deleted transfer "${title}" (${id}).`;
      onStatus(msg);
      setTransferStatus(msg);
      if (transferDetail?.id === id) setTransferDetail(null);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete transfer";
      onError(msg);
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleDrainTransferMediaQueue = async () => {
    setTransferActionLoading("drain");
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/process-media", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode: "drain", limit: 25 }),
      });
      const data = (await res.json().catch(() => ({}))) as MediaActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to inspect transfer media queue");
      }
      const msg = data.workerDisabled
        ? `Worker disabled. Pending queue: ${data.queueLength ?? 0}.`
        : `Drained queue: processed ${data.processedJobs ?? 0}, succeeded ${data.succeeded ?? 0}, failed ${data.failed ?? 0}, remaining ${data.queueLength ?? 0}.`;
      onStatus(msg);
      setTransferStatus(msg);
      await Promise.all([
        loadTransfers(),
        transferDetail ? handleLoadTransferDetail(transferDetail.id) : Promise.resolve(),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to inspect transfer media queue";
      onError(msg);
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleBackfillTransferMedia = async (transferId: string) => {
    setTransferActionLoading(`backfill:${transferId}`);
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/process-media", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode: "backfill", transferId }),
      });
      const data = (await res.json().catch(() => ({}))) as MediaActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to backfill transfer media");
      }
      const msg = `Backfilled transfer ${transferId}.`;
      onStatus(msg);
      setTransferStatus(msg);
      await Promise.all([loadTransfers(), handleLoadTransferDetail(transferId)]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to backfill transfer media";
      onError(msg);
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleRetryTransferFile = async (transferId: string, mediaId: string, filename: string) => {
    setTransferActionLoading(`retry:${transferId}:${mediaId}`);
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/process-media", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode: "retry", transferId, mediaId, filename, force: true }),
      });
      const data = (await res.json().catch(() => ({}))) as MediaActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to retry transfer file");
      }
      const msg =
        data.requeued === false
          ? `Retry skipped for ${filename}: ${data.processingStatus ?? "unchanged"}.`
          : `Retried ${filename}: ${data.processingStatus ?? "queued"}.`;
      onStatus(msg);
      setTransferStatus(msg);
      await Promise.all([loadTransfers(), handleLoadTransferDetail(transferId)]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to retry transfer file";
      onError(msg);
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleCleanupExpiredTransfers = async (mode: "index" | "deep" = "index") => {
    if (
      !(await confirmAction({
        eyebrow: "transfer cleanup",
        title: mode === "deep" ? "Run deep cleanup?" : "Run quick cleanup?",
        description:
          mode === "deep"
            ? "This scans transfer storage for orphaned prefixes and may take longer."
            : "This removes expired Redis index entries while keeping active transfers.",
        confirmLabel: mode === "deep" ? "run deep cleanup" : "run cleanup",
        intent: "danger",
      }))
    ) {
      return;
    }
    if (mode === "deep") setTransferDeepCleanupLoading(true);
    else setTransferCleanupLoading(true);
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/cleanup", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as TransferCleanupResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to run cleanup");
      }
      const msg =
        mode === "deep"
          ? `Deep cleanup complete: removed ${data.deletedObjects ?? 0} orphaned files across ${data.scannedPrefixes ?? 0} prefixes.`
          : `Quick cleanup complete: removed ${data.expiredIndexEntries ?? 0} expired index entries.`;
      onStatus(msg);
      setTransferStatus(msg);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to run cleanup";
      onError(msg);
    } finally {
      if (mode === "deep") setTransferDeepCleanupLoading(false);
      else setTransferCleanupLoading(false);
    }
  };

  const handleNukeTransfers = async () => {
    if (
      !(await confirmAction({
        eyebrow: "transfer manager",
        title: "Delete every transfer?",
        description:
          "This permanently deletes all active transfers, their metadata, and every stored transfer file.",
        confirmLabel: "delete all transfers",
        intent: "danger",
      }))
    ) {
      return;
    }
    setTransferNukeLoading(true);
    onError("");
    onStatus("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/nuke", {
        method: "POST",
        headers: withStepUpHeaders(stepToken),
      });
      const data = (await res.json().catch(() => ({}))) as TransferCleanupResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to nuke transfers");
      }
      const msg = `Nuke complete: deleted ${data.deletedTransfers ?? 0} transfers and ${data.deletedFiles ?? 0} files.`;
      onStatus(msg);
      setTransferStatus(msg);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to nuke transfers";
      onError(msg);
    } finally {
      setTransferNukeLoading(false);
    }
  };

  const cleanupTransfersAndScroll = async () => {
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await handleCleanupExpiredTransfers();
  };

  const deepCleanupTransfersAndScroll = async () => {
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await handleCleanupExpiredTransfers("deep");
  };

  const nukeTransfersAndScroll = async () => {
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await handleNukeTransfers();
  };

  const filteredTransfers = useMemo(() => {
    const q = transferQuery.trim().toLowerCase();
    return transfers.filter(
      (transfer) =>
        !q || transfer.id.toLowerCase().includes(q) || transfer.title.toLowerCase().includes(q),
    );
  }, [transferQuery, transfers]);
  const visibleTransfers = showAllTransfers ? filteredTransfers : filteredTransfers.slice(0, 15);
  const visibleTransferFiles = useMemo(
    () =>
      transferDetail?.files.filter((file) =>
        transferFileMatchesHealthFilter(file, transferHealthFilter),
      ) ?? [],
    [transferDetail, transferHealthFilter],
  );

  return (
    <>
      <UploadAccessPanel
        authFetch={authFetch}
        ensureStepUpToken={ensureStepUpToken}
        onError={onError}
        onStatus={onStatus}
      />

      <div
        id="transfer-manager"
        ref={transfersSectionRef}
        className="border-t theme-border pt-6 space-y-3 scroll-mt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs theme-muted">private file delivery</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={transferActionLoading === "drain"}
              onClick={() => void handleDrainTransferMediaQueue()}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title="Refresh queue stats while the worker path is disabled."
            >
              {transferActionLoading === "drain" ? "checking..." : "check queue"}
            </button>
            <button
              type="button"
              disabled={transfersLoading}
              onClick={() => void loadTransfersAndScroll()}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title="Refreshes active transfer rows and expiry timings."
            >
              {transfersLoading ? "refreshing..." : "refresh"}
            </button>
          </div>
        </div>
        <details className="border-y theme-border py-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-mono text-xs theme-muted marker:content-none">
            maintenance and destructive actions
          </summary>
          <div className="border-t theme-border pt-4">
            <p className="max-w-2xl font-mono text-micro leading-relaxed theme-muted">
              Cleanup is rarely needed during normal operation. Deep cleanup scans storage; delete
              all permanently removes every active transfer and file.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <button
                type="button"
                disabled={transferCleanupLoading}
                onClick={() => void cleanupTransfersAndScroll()}
                className="min-h-11 font-mono text-xs theme-muted underline underline-offset-4 disabled:opacity-50"
              >
                {transferCleanupLoading ? "cleaning…" : "quick cleanup"}
              </button>
              <button
                type="button"
                disabled={transferDeepCleanupLoading}
                onClick={() => void deepCleanupTransfersAndScroll()}
                className="min-h-11 font-mono text-xs theme-muted underline underline-offset-4 disabled:opacity-50"
              >
                {transferDeepCleanupLoading ? "deep cleaning…" : "deep cleanup"}
              </button>
              <button
                type="button"
                disabled={transferNukeLoading}
                onClick={() => void nukeTransfersAndScroll()}
                className="min-h-11 font-mono text-xs text-[var(--status-danger)] underline underline-offset-4 disabled:opacity-50"
              >
                {transferNukeLoading ? "deleting all…" : "delete all transfers"}
              </button>
            </div>
          </div>
        </details>
        <input
          type="text"
          value={transferQuery}
          onChange={(e) => {
            setTransferQuery(e.target.value);
            setShowAllTransfers(false);
          }}
          placeholder="filter transfers by title or id"
          className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
        />
        {transferStatusMessage ? (
          <p className="font-mono text-xs" role="status">
            <AdminStatus tone="positive">{transferStatusMessage}</AdminStatus>
          </p>
        ) : null}

        {transfersLoadError ? (
          <AdminLoadError
            message={transfersLoadError}
            retry={() => void loadTransfers()}
            retrying={transfersLoading}
          />
        ) : transfersLoading && transfers.length === 0 ? (
          <AdminLoading label="Loading active transfers…" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-3">
              <div className="border theme-border rounded-md p-3">
                <p className="theme-muted text-xs">active transfers</p>
                <p className="text-lg">{transfers.length}</p>
              </div>
              <div className="border theme-border rounded-md p-3">
                <p className="theme-muted text-xs">files in transfers</p>
                <p className="text-lg">{transfers.reduce((sum, t) => sum + t.fileCount, 0)}</p>
              </div>
              <div className="border theme-border rounded-md p-3">
                <p className="theme-muted text-xs">expiring in 24h</p>
                <p className="text-lg">
                  {
                    transfers.filter((t) => t.remainingSeconds > 0 && t.remainingSeconds <= 86400)
                      .length
                  }
                </p>
              </div>
            </div>
            {transferMediaStats ? (
              <div className="grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-3">
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">media queue</p>
                  <p className="text-lg">
                    <AdminStatus
                      tone={transferMediaStats.queueLength > 0 ? "attention" : "positive"}
                    >
                      {transferMediaStats.queueLength > 0
                        ? `${transferMediaStats.queueLength} queued`
                        : "clear"}
                    </AdminStatus>
                  </p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">last heartbeat</p>
                  <p className="text-sm">
                    {transferMediaStats.worker.lastHeartbeatAt
                      ? new Date(transferMediaStats.worker.lastHeartbeatAt).toLocaleString(
                          "en-GB",
                          {
                            timeZone: "Europe/London",
                          },
                        )
                      : "—"}
                  </p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">last processed</p>
                  <p className="text-sm">
                    {transferMediaStats.worker.lastProcessedAt
                      ? new Date(transferMediaStats.worker.lastProcessedAt).toLocaleString(
                          "en-GB",
                          {
                            timeZone: "Europe/London",
                          },
                        )
                      : "—"}
                  </p>
                </div>
              </div>
            ) : null}
            {transferMediaStats?.worker.lastErrorMessage ? (
              <p className="border-l-2 border-[var(--status-danger)] pl-3 font-mono text-xs">
                <AdminStatus tone="danger">
                  worker error{" "}
                  {transferMediaStats.worker.lastErrorAt
                    ? `(${new Date(transferMediaStats.worker.lastErrorAt).toLocaleString("en-GB", { timeZone: "Europe/London" })})`
                    : ""}
                  : {transferMediaStats.worker.lastErrorMessage}
                </AdminStatus>
              </p>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
              {transferDetailError || transferDetail ? (
                <aside
                  ref={transferDetailRef}
                  aria-label="Selected transfer details"
                  className="order-1 self-start border-y theme-border py-4 lg:order-2 lg:sticky lg:top-6"
                >
                  {transferDetailError ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setTransferDetailError(null)}
                        className="mb-3 min-h-11 font-mono text-xs theme-muted underline underline-offset-4 lg:hidden"
                      >
                        ← back to transfers
                      </button>
                      <AdminLoadError
                        message={transferDetailError.message}
                        retry={() => void handleLoadTransferDetail(transferDetailError.id)}
                        retrying={transferDetailLoading === transferDetailError.id}
                      />
                    </div>
                  ) : transferDetail ? (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-mono text-sm">
                          {transferDetail.title || "untitled"}{" "}
                          <span className="theme-muted">· {transferDetail.id}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => setTransferDetail(null)}
                          className="min-h-11 shrink-0 font-mono text-xs theme-muted underline underline-offset-4"
                        >
                          back to transfers
                        </button>
                      </div>
                      <div
                        className="flex flex-wrap gap-2 border-t theme-border pt-3 font-mono text-xs"
                        aria-label="Filter selected transfer files"
                      >
                        {(["all", "queued", "processing", "failed", "worker"] as const).map(
                          (filter) => (
                            <button
                              key={filter}
                              type="button"
                              onClick={() => setTransferHealthFilter(filter)}
                              aria-pressed={transferHealthFilter === filter}
                              className={
                                transferHealthFilter === filter
                                  ? "min-h-11 border theme-border-strong px-3 font-mono text-xs"
                                  : "min-h-11 px-3 font-mono text-xs theme-muted underline underline-offset-4"
                              }
                            >
                              {filter}
                            </button>
                          ),
                        )}
                      </div>
                      <div className="space-y-2">
                        {visibleTransferFiles.map((file) => (
                          <div
                            key={`${transferDetail.id}:${file.id}:${file.filename}`}
                            className="border-t theme-border pt-3 font-mono text-xs theme-muted"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="break-words text-[var(--foreground)]">
                                  {file.filename}
                                </div>
                                <div className="mt-1 break-words">
                                  {file.kind} · {file.processingBackend ?? "n/a"} ·{" "}
                                  <AdminStatus tone={adminToneForStatus(file.processingStatus)}>
                                    {file.processingStatus ?? "n/a"}
                                  </AdminStatus>
                                  {file.processingRoute ? ` · ${file.processingRoute}` : ""}
                                  {file.previewSource ? ` · ${file.previewSource}` : ""}
                                  {file.processingErrorCode ? ` · ${file.processingErrorCode}` : ""}
                                </div>
                                {file.processingErrorDetail ? (
                                  <div className="mt-1 break-words text-[10px]">
                                    <AdminStatus tone="danger">
                                      {file.processingErrorDetail}
                                    </AdminStatus>
                                  </div>
                                ) : null}
                              </div>
                              {file.processingStatus === "failed" ||
                              file.processingStatus === "queued" ||
                              file.processingStatus === "processing" ? (
                                <button
                                  type="button"
                                  disabled={
                                    transferActionLoading ===
                                    `retry:${transferDetail.id}:${file.id}`
                                  }
                                  onClick={() =>
                                    void handleRetryTransferFile(
                                      transferDetail.id,
                                      file.id,
                                      file.filename,
                                    )
                                  }
                                  className="min-h-11 shrink-0 font-mono text-xs theme-muted underline underline-offset-4 disabled:opacity-50"
                                >
                                  {transferActionLoading === `retry:${transferDetail.id}:${file.id}`
                                    ? "retrying…"
                                    : "retry"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {visibleTransferFiles.length === 0 ? (
                          <p className="border-t theme-border pt-4 font-mono text-xs theme-muted">
                            No files match this state.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </aside>
              ) : (
                <aside className="order-1 hidden self-start border-y theme-border py-5 font-mono text-xs theme-muted lg:order-2 lg:block">
                  Choose details on a transfer to inspect its files and processing state.
                </aside>
              )}

              <div
                className={`order-2 space-y-2 lg:order-1 lg:block ${
                  transferDetailError || transferDetail ? "hidden" : ""
                }`}
              >
                {filteredTransfers.length === 0 ? (
                  <p className="border-y theme-border py-5 font-mono text-xs theme-muted">
                    {transfers.length === 0
                      ? "No active transfers."
                      : "No transfers match these filters."}
                  </p>
                ) : null}
                {visibleTransfers.map((transfer) => (
                  <article key={transfer.id} className="border-y theme-border py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm">{transfer.title || "untitled"}</p>
                        <p className="mt-1 break-words font-mono text-xs theme-muted">
                          {transfer.id} · {transfer.fileCount} files ·{" "}
                          {transfer.remainingSeconds > 0 && transfer.remainingSeconds <= 86400 ? (
                            <AdminStatus tone="attention">
                              expires in {formatRemaining(transfer.remainingSeconds)}
                            </AdminStatus>
                          ) : (
                            <span>expires in {formatRemaining(transfer.remainingSeconds)}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                        <Link
                          to="/t/$id"
                          params={{ id: transfer.id }}
                          search={{ token: undefined }}
                          className="inline-flex min-h-11 items-center font-mono text-xs theme-muted underline underline-offset-4"
                        >
                          open
                        </Link>
                        <button
                          type="button"
                          onClick={() => void copyTransferUrl(transfer.id)}
                          className="min-h-11 font-mono text-xs theme-muted underline underline-offset-4"
                        >
                          {copiedTransferId === transfer.id ? "copied" : "copy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLoadTransferDetail(transfer.id)}
                          className="min-h-11 font-mono text-xs underline underline-offset-4"
                        >
                          {transferDetailLoading === transfer.id ? "loading…" : "details"}
                        </button>
                        <button
                          type="button"
                          disabled={transferActionLoading === `backfill:${transfer.id}`}
                          onClick={() => void handleBackfillTransferMedia(transfer.id)}
                          className="min-h-11 font-mono text-xs theme-muted underline underline-offset-4 disabled:opacity-50"
                        >
                          {transferActionLoading === `backfill:${transfer.id}`
                            ? "backfilling…"
                            : "backfill"}
                        </button>
                        <button
                          type="button"
                          disabled={transferActionLoading === transfer.id}
                          onClick={() =>
                            void handleDeleteTransfer(transfer.id, transfer.title || "untitled")
                          }
                          className="min-h-11 font-mono text-xs text-[var(--status-danger)] underline underline-offset-4 disabled:opacity-50"
                        >
                          {transferActionLoading === transfer.id ? "deleting…" : "delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {filteredTransfers.length > 15 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllTransfers((v) => !v)}
                    className="min-h-11 font-mono text-xs theme-muted underline underline-offset-4"
                  >
                    {showAllTransfers
                      ? "show fewer transfers"
                      : `show all transfers (${filteredTransfers.length})`}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
      {actionDialog}
    </>
  );
}
