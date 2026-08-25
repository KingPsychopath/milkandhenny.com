"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { buildTransferUrl } from "@/features/transfers/routes";
import { copyText } from "@/lib/client/share";
import { useActionDialog } from "@/hooks/useActionDialog";
import { formatRemaining } from "../format";
import { UploadAccessPanel } from "./UploadAccessPanel";

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

function transferMatchesHealthFilter(
  transfer: TransferSummary,
  detail: AdminTransferDetail | null,
  filter: TransferHealthFilter,
): boolean {
  if (filter === "all") return true;
  if (!detail || detail.id !== transfer.id) return false;
  if (filter === "queued") return detail.files.some((file) => file.processingStatus === "queued");
  if (filter === "processing")
    return detail.files.some((file) => file.processingStatus === "processing");
  if (filter === "failed") return detail.files.some((file) => file.processingStatus === "failed");
  return detail.files.some((file) => file.processingBackend === "worker");
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
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transferMediaStats, setTransferMediaStats] = useState<TransferMediaAdminStats | null>(
    null,
  );
  const [transferDetail, setTransferDetail] = useState<AdminTransferDetail | null>(null);
  const [transferDetailLoading, setTransferDetailLoading] = useState<string | null>(null);
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
    onError("");
    try {
      const res = await authFetch(`/api/admin/transfers/${encodeURIComponent(id)}`);
      const data = (await res.json().catch(() => ({}))) as TransferDetailResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load transfer");
      }
      setTransferDetail((data.transfer as AdminTransferDetail) ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load transfer";
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
    return transfers.filter((transfer) => {
      const matchesQuery =
        !q || transfer.id.toLowerCase().includes(q) || transfer.title.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      return transferMatchesHealthFilter(transfer, transferDetail, transferHealthFilter);
    });
  }, [transferDetail, transferHealthFilter, transferQuery, transfers]);
  const visibleTransfers = showAllTransfers ? filteredTransfers : filteredTransfers.slice(0, 15);

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
              disabled={transferNukeLoading}
              onClick={() => void nukeTransfersAndScroll()}
              className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
              title="Deletes all transfers and transfer files. Use with care."
            >
              {transferNukeLoading ? "nuking..." : "nuke all"}
            </button>
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
              disabled={transferCleanupLoading}
              onClick={() => void cleanupTransfersAndScroll()}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title="Quick cleanup: removes expired transfer index entries without scanning the whole bucket."
            >
              {transferCleanupLoading ? "cleaning..." : "quick cleanup"}
            </button>
            <button
              type="button"
              disabled={transferDeepCleanupLoading}
              onClick={() => void deepCleanupTransfersAndScroll()}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title="Deep cleanup: scans transfer storage for orphaned prefixes. Use only when needed."
            >
              {transferDeepCleanupLoading ? "deep cleaning..." : "deep cleanup"}
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
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          {(["all", "queued", "processing", "failed", "worker"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setTransferHealthFilter(filter)}
              className={
                transferHealthFilter === filter
                  ? "min-h-10 px-3 py-1 rounded-sm border theme-border text-[var(--foreground)]"
                  : "min-h-10 px-3 py-1 rounded-sm border theme-border theme-muted hover:text-[var(--foreground)] transition-colors"
              }
            >
              {filter}
            </button>
          ))}
        </div>

        {transferStatusMessage ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">{transferStatusMessage}</p>
        ) : null}

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
              <p className="text-lg">{transferMediaStats.queueLength}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">last heartbeat</p>
              <p className="text-sm">
                {transferMediaStats.worker.lastHeartbeatAt
                  ? new Date(transferMediaStats.worker.lastHeartbeatAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })
                  : "—"}
              </p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">last processed</p>
              <p className="text-sm">
                {transferMediaStats.worker.lastProcessedAt
                  ? new Date(transferMediaStats.worker.lastProcessedAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })
                  : "—"}
              </p>
            </div>
          </div>
        ) : null}
        {transferMediaStats?.worker.lastErrorMessage ? (
          <p className="font-mono text-xs theme-muted">
            worker error{" "}
            {transferMediaStats.worker.lastErrorAt
              ? `(${new Date(transferMediaStats.worker.lastErrorAt).toLocaleString("en-GB", { timeZone: "Europe/London" })})`
              : ""}
            : {transferMediaStats.worker.lastErrorMessage}
          </p>
        ) : null}

        {filteredTransfers.length === 0 && !transfersLoading ? (
          <p className="font-mono text-xs theme-muted">No active transfers.</p>
        ) : null}

        <div className="space-y-2">
          {visibleTransfers.map((transfer) => (
            <div key={transfer.id} className="border theme-border rounded-md p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm truncate">{transfer.title || "untitled"}</p>
                  <p className="font-mono text-xs theme-muted truncate">
                    {transfer.id} · {transfer.fileCount} files · expires in{" "}
                    {formatRemaining(transfer.remainingSeconds)} · until{" "}
                    {new Date(transfer.expiresAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to="/t/$id"
                    params={{ id: transfer.id }}
                    search={{ token: undefined }}
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                    title="Open the public transfer page."
                  >
                    open
                  </Link>
                  <button
                    type="button"
                    onClick={() => void copyTransferUrl(transfer.id)}
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                    title="Copy the public transfer URL."
                  >
                    {copiedTransferId === transfer.id ? "copied" : "copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLoadTransferDetail(transfer.id)}
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                    title="Inspect file processing details."
                  >
                    {transferDetailLoading === transfer.id ? "loading..." : "details"}
                  </button>
                  <button
                    type="button"
                    disabled={transferActionLoading === `backfill:${transfer.id}`}
                    onClick={() => void handleBackfillTransferMedia(transfer.id)}
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                    title="Re-check transfer media and retry failed items locally when possible."
                  >
                    {transferActionLoading === `backfill:${transfer.id}`
                      ? "backfilling..."
                      : "backfill"}
                  </button>
                  <button
                    type="button"
                    disabled={transferActionLoading === transfer.id}
                    onClick={() =>
                      void handleDeleteTransfer(transfer.id, transfer.title || "untitled")
                    }
                    className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                    title="Delete this transfer now (metadata + R2 files)."
                  >
                    {transferActionLoading === transfer.id ? "deleting..." : "delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {transferDetail ? (
          <div className="border theme-border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm">
                {transferDetail.title || "untitled"}{" "}
                <span className="theme-muted">· {transferDetail.id}</span>
              </p>
              <button
                type="button"
                onClick={() => setTransferDetail(null)}
                className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
              >
                close
              </button>
            </div>
            <div className="space-y-1">
              {transferDetail.files.map((file) => (
                <div
                  key={`${transferDetail.id}:${file.id}:${file.filename}`}
                  className="font-mono text-xs theme-muted border theme-border rounded-sm px-2 py-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--foreground)]">{file.filename}</div>
                      <div className="truncate">
                        {file.kind} · {file.processingBackend ?? "n/a"} ·{" "}
                        {file.processingStatus ?? "n/a"}
                        {file.processingRoute ? ` · ${file.processingRoute}` : ""}
                        {file.previewSource ? ` · ${file.previewSource}` : ""}
                        {file.processingErrorCode ? ` · ${file.processingErrorCode}` : ""}
                      </div>
                      {file.processingErrorDetail ? (
                        <div className="mt-1 break-words text-[10px] opacity-80">
                          {file.processingErrorDetail}
                        </div>
                      ) : null}
                    </div>
                    {file.processingStatus === "failed" ||
                    file.processingStatus === "queued" ||
                    file.processingStatus === "processing" ? (
                      <button
                        type="button"
                        disabled={transferActionLoading === `retry:${transferDetail.id}:${file.id}`}
                        onClick={() =>
                          void handleRetryTransferFile(transferDetail.id, file.id, file.filename)
                        }
                        className="shrink-0 font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                        title="Force this file back through the media pipeline."
                      >
                        {transferActionLoading === `retry:${transferDetail.id}:${file.id}`
                          ? "retrying..."
                          : "retry"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {filteredTransfers.length > 15 ? (
          <button
            type="button"
            onClick={() => setShowAllTransfers((v) => !v)}
            className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
          >
            {showAllTransfers
              ? "show fewer transfers"
              : `show all transfers (${filteredTransfers.length})`}
          </button>
        ) : null}
      </div>
      {actionDialog}
    </>
  );
}
