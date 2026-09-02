"use client";

import { useState } from "react";

import {
  getTransferUploadRecoveryExpiresAt,
  type RecoverySelectionState,
  type TransferUploadRecovery,
} from "./recovery";

export type RecoveryCheckStatus =
  | "checking"
  | "available"
  | "finishing"
  | "discarding"
  | "expired"
  | "unavailable";

type TransferRecoveryPanelProps = {
  recovery: TransferUploadRecovery;
  checkStatus: RecoveryCheckStatus;
  selectionState: RecoverySelectionState;
  uploadedNames: string[];
  isOnline: boolean;
  onChooseFiles: () => void;
  onContinue: () => void;
  onCheckAgain: () => void;
  onDiscard: () => void;
};

function fileCountLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 b";
  const units = ["b", "kb", "mb", "gb"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`;
}

function formatCheckpointTime(value: number): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TransferRecoveryPanel({
  recovery,
  checkStatus,
  selectionState,
  uploadedNames,
  isOnline,
  onChooseFiles,
  onContinue,
  onCheckAgain,
  onDiscard,
}: TransferRecoveryPanelProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const expectedCount = recovery.sourceFiles.length;
  const uploadedNameSet = new Set(uploadedNames);
  const fileRows = recovery.sourceFiles.map((source, index) => ({
    ...source,
    received: uploadedNameSet.has(recovery.files[index]?.name ?? ""),
  }));
  const uploadedFileCount = fileRows.filter((file) => file.received).length;
  const totalBytes = fileRows.reduce((sum, file) => sum + file.size, 0);
  const uploadedBytes = fileRows.reduce((sum, file) => sum + (file.received ? file.size : 0), 0);
  const completedPercent =
    totalBytes > 0
      ? Math.round((uploadedBytes / totalBytes) * 100)
      : uploadedFileCount > 0
        ? 100
        : 0;

  let title = "unfinished transfer found";
  let detail = `Reselect the original ${fileCountLabel(expectedCount)}. Completed files stay in this transfer; only missing or interrupted files are sent again.`;
  let tone = "mh-status--attention";

  if (!isOnline) {
    title = "upload paused while you’re offline";
    detail = "Keep this tab open. When your connection returns, we’ll check what arrived safely.";
  } else if (checkStatus === "checking") {
    detail = "Checking what safely reached storage. You can select the original files now.";
  } else if (checkStatus === "finishing") {
    title = "all files received · finishing now";
    detail = "You don’t need to reselect anything. We’re creating the share link.";
    tone = "mh-status--positive";
  } else if (checkStatus === "discarding") {
    title = "discarding unfinished transfer";
    detail = "Removing safely stored parts and closing this upload reservation.";
  } else if (checkStatus === "expired") {
    title = "this upload can no longer be resumed";
    detail = "The secure upload window expired. Start again to create fresh upload links.";
    tone = "mh-status--danger";
  } else if (checkStatus === "unavailable") {
    title = "we couldn’t check the saved upload";
    detail =
      "Your recovery details are still safe in this tab. Check your connection and try again.";
    tone = "mh-status--danger";
  } else if (selectionState === "matches") {
    title = "ready to continue";
    detail = `${fileCountLabel(uploadedFileCount)} complete. Continue below; only missing or interrupted files will be sent.`;
    tone = "mh-status--positive";
  } else if (selectionState === "mismatch") {
    title = "these aren’t the same files";
    detail = `Choose all ${fileCountLabel(expectedCount)} from the interrupted upload together. Nothing has been overwritten.`;
    tone = "mh-status--danger";
  } else if (uploadedFileCount > 0) {
    detail = `${fileCountLabel(uploadedFileCount)} complete. Reselect the original ${fileCountLabel(expectedCount)} so we can safely send only what is missing.`;
  }

  const isBusy = checkStatus === "finishing" || checkStatus === "discarding";
  const canChoose = !isBusy && checkStatus !== "expired" && selectionState !== "matches";
  const canContinue = isOnline && checkStatus === "available" && selectionState === "matches";
  const canRetry = isOnline && checkStatus === "unavailable";
  const mustRestart = checkStatus === "expired";

  return (
    <section className={`mh-status ${tone} mb-6`} aria-labelledby="recovery-title">
      <span className="mh-status__mark" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p id="recovery-title" className="mh-status__label">
          {title}
        </p>
        <p className="mh-status__detail">{detail}</p>

        <dl className="mt-3 grid gap-x-4 gap-y-1 font-mono text-micro sm:grid-cols-[auto_1fr]">
          <dt className="theme-faint">transfer</dt>
          <dd className="break-all theme-muted">{recovery.title || recovery.transferId}</dd>
          <dt className="theme-faint">started</dt>
          <dd className="theme-muted">{formatCheckpointTime(recovery.createdAt)}</dd>
          <dt className="theme-faint">resume by</dt>
          <dd className="theme-muted">
            {formatCheckpointTime(getTransferUploadRecoveryExpiresAt(recovery))}
          </dd>
        </dl>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 font-mono text-micro">
            <span>
              {uploadedFileCount === 0
                ? `no complete files yet · ${formatBytes(totalBytes)} still to send`
                : `${uploadedFileCount} of ${expectedCount} files complete · ${formatBytes(uploadedBytes)} stored`}
            </span>
            <span className="shrink-0 theme-muted">{completedPercent}%</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-label="Safely stored upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completedPercent}
          >
            <div
              className="h-full bg-[var(--foreground)]"
              style={{ width: `${completedPercent}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-micro theme-faint">
            Progress is saved after each complete file. An interrupted file restarts when
            reselected.
          </p>
        </div>

        <details className="mt-2 font-mono text-micro theme-muted" open={expectedCount <= 5}>
          <summary className="min-h-11 cursor-pointer py-3">
            files in this transfer ({expectedCount})
          </summary>
          <ul className="space-y-2">
            {fileRows.slice(0, 20).map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`} className="flex gap-3">
                <span className="min-w-0 flex-1 break-all">{file.name}</span>
                <span className="shrink-0 theme-faint">{formatBytes(file.size)}</span>
                <span className="w-16 shrink-0 text-right">
                  {checkStatus === "checking"
                    ? "checking"
                    : file.received
                      ? "complete"
                      : "send again"}
                </span>
              </li>
            ))}
            {fileRows.length > 20 ? <li>and {fileRows.length - 20} more</li> : null}
          </ul>
        </details>

        <div className="mt-3 flex flex-wrap gap-3">
          {canContinue ? (
            <button type="button" onClick={onContinue} className="mh-action mh-action--primary">
              continue upload
            </button>
          ) : null}
          {canChoose ? (
            <button
              type="button"
              onClick={onChooseFiles}
              className={`mh-action ${canRetry ? "mh-action--secondary" : "mh-action--primary"}`}
            >
              {selectionState === "mismatch" ? "choose again" : "choose files to continue"}
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" onClick={onCheckAgain} className="mh-action mh-action--primary">
              check again
            </button>
          ) : null}
          {!isBusy && !confirmDiscard ? (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              className={
                mustRestart ? "mh-action mh-action--primary" : "mh-action mh-action--quiet"
              }
            >
              {mustRestart ? "discard and start new" : "discard unfinished transfer"}
            </button>
          ) : null}
        </div>
        {confirmDiscard && !isBusy ? (
          <div
            className="mt-3 rounded border theme-border p-3"
            role="group"
            aria-label="Confirm discard"
          >
            <p className="font-mono text-xs">
              Delete the stored parts and close this unfinished transfer?
            </p>
            <p className="mt-1 font-mono text-micro theme-muted">
              This cannot be undone. Your original files on this device are not affected.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="mh-action mh-action--quiet"
              >
                keep transfer
              </button>
              <button type="button" onClick={onDiscard} className="mh-action mh-action--danger">
                delete stored parts
              </button>
            </div>
          </div>
        ) : null}
        {!isBusy ? (
          <p className="mt-2 font-mono text-micro theme-faint">
            Discard removes this checkpoint, its upload reservation, and any parts already stored.
          </p>
        ) : null}
      </div>
    </section>
  );
}
