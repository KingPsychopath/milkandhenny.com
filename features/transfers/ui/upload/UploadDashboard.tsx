"use client";

import { AppSelect } from "@/components/AppSelect";
import { useState, useRef, useCallback, useEffect, useDeferredValue } from "react";
import { Link } from "@tanstack/react-router";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";
import { SITE_BRAND } from "@/lib/shared/config";
import { getResponseErrorMessage, readResponsePayload } from "@/lib/client/response";
import {
  isHeifLikeFile,
  prepareBrowserImage,
  type PreparedBrowserImage,
} from "@/features/media/browser-image-prep.client";
import { registerApplicationFileDrop } from "@/features/media/ApplicationFileDrop";
import { collectDroppedFiles } from "@/features/media/collect-dropped-files.client";
import { inferTransferTitle } from "@/features/transfers/presentation";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { copyText } from "@/lib/client/share";
import {
  uploadPresignedTarget,
  type MultipartUploadCompletion,
  type PresignedMultipartUpload,
} from "@/lib/client/presigned-upload";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";
import {
  clearTransferUploadRecovery,
  clearLastTransferResult,
  getRecoverySelectionState,
  getRecoveryStorageState,
  readLastTransferResult,
  readTransferUploadRecovery,
  orderSourceFilesForRecovery,
  saveLastTransferResult,
  saveTransferUploadRecovery,
  type SavedTransferResult,
  type TransferUploadRecovery,
} from "./recovery";
import { TransferRecoveryPanel, type RecoveryCheckStatus } from "./TransferRecoveryPanel";

/* ─── Types ─── */

type TransferAction = "create" | "append";

type TransferResult = SavedTransferResult;

type UploadProgress = {
  phase: "preparing" | "authorizing" | "uploading" | "processing";
  current: number;
  total: number;
  filename?: string;
  uploadedBytes?: number;
  totalBytes?: number;
  attempt?: number;
  totalAttempts?: number;
};

/* ─── Helpers ─── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 b";
  const k = 1024;
  const sizes = ["b", "kb", "mb", "gb"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const EXPIRY_OPTIONS = [
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
] as const;

/* ─── Component ─── */

type UploadDashboardProps = {
  isAdmin: boolean;
  accessExpiresAt: string | null;
  initialAppendTransferId?: string;
  initialAppendOwnerToken?: string;
};

const DIRECT_UPLOAD_CONCURRENCY = 4;
const DIRECT_UPLOAD_RETRIES = 3;
const API_REQUEST_RETRIES = 2;
const API_REQUEST_TIMEOUT_MS = 20_000;
const API_FINALIZE_TIMEOUT_MS = 5 * 60_000;
const BROWSER_PREP_MODE = import.meta.env.VITE_TRANSFER_MEDIA_BROWSER_PREP ?? "auto";
const BROWSER_PREP_CONCURRENCY = 2;
const LARGE_BATCH_ENTRY_COUNT = 24;
const LARGE_BATCH_UPLOAD_CONCURRENCY = 2;

function sanitizeUrlForLogs(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function formatUploadContext(params: {
  file: File;
  label: string;
  contentType: string;
  url: string;
  attempt: number;
  totalAttempts: number;
}): string {
  const bits = [
    `file=${params.file.name}`,
    `label=${params.label}`,
    `size=${params.file.size}`,
    `fileType=${params.file.type || "(empty)"}`,
    `putType=${params.contentType || "(empty)"}`,
    `url=${sanitizeUrlForLogs(params.url)}`,
    `attempt=${params.attempt}/${params.totalAttempts}`,
  ];
  return bits.join(" | ");
}

async function isReadableLocalFile(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function toFriendlyUploadError(error: unknown, file?: File): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Upload stalled")) {
    return new Error("Storage stopped responding. We paused safely so you can continue.");
  }

  if (!file) {
    return error instanceof Error ? error : new Error("Upload failed");
  }

  const isGenericFetchFailure =
    message === "Failed to fetch" ||
    message.includes("ERR_UPLOAD_FILE_CHANGED") ||
    message.includes("ERR_FILE_NOT_FOUND");

  if (!isGenericFetchFailure) {
    return error instanceof Error ? error : new Error("Upload failed");
  }

  const readable = await isReadableLocalFile(file);
  if (!readable) {
    return new Error(
      `The browser lost access to ${file.name}. Copy files to a normal local folder and retry, or use CLI.`,
    );
  }

  return new Error("Storage connection failed. Check your connection and try again.");
}

function buildUploadFailureMessage(params: {
  file: File;
  label: string;
  contentType: string;
  url: string;
  error: unknown;
  attempt: number;
  totalAttempts: number;
}): Error {
  const context = formatUploadContext(params);
  const message =
    params.error instanceof Error && params.error.message
      ? params.error.message
      : String(params.error);

  console.error("Direct upload failed", {
    context,
    error: params.error,
  });

  return new Error(`Failed to upload ${params.file.name}. ${message}`);
}

function getUploadProgressPercent(progress: UploadProgress): number | null {
  if (progress.phase === "authorizing" || progress.phase === "processing") return null;
  if (progress.phase === "uploading" && progress.totalBytes) {
    return Math.max(
      0,
      Math.min(100, Math.round(((progress.uploadedBytes ?? 0) / progress.totalBytes) * 100)),
    );
  }
  if (progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
}

function getUploadProgressLabel(progress: UploadProgress): string {
  if (progress.phase === "preparing") {
    return `preparing ${progress.current}/${progress.total}`;
  }
  if (progress.phase === "authorizing") {
    return "requesting a secure upload link";
  }
  if (progress.phase === "processing") {
    return `processing previews for ${progress.total} file${progress.total === 1 ? "" : "s"}`;
  }
  if (progress.totalBytes) {
    return `uploading ${formatBytes(progress.uploadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`;
  }
  return `uploading ${progress.current}/${progress.total}`;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function uploadMetadataMatches(
  current: TransferUploadFileInput,
  saved: TransferUploadFileInput,
): boolean {
  return (
    current.name === saved.name &&
    current.size === saved.size &&
    (current.type ?? "") === (saved.type ?? "") &&
    (current.originalName ?? "") === (saved.originalName ?? "") &&
    (current.originalSize ?? 0) === (saved.originalSize ?? 0) &&
    (current.originalType ?? "") === (saved.originalType ?? "") &&
    (current.convertedFrom ?? "") === (saved.convertedFrom ?? "")
  );
}

function getOwnerToken(result: TransferResult): string | null {
  try {
    return new URL(result.adminUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

export function UploadDashboard({
  isAdmin,
  accessExpiresAt,
  initialAppendTransferId,
  initialAppendOwnerToken,
}: UploadDashboardProps) {
  /* Upload state */
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [recovery, setRecovery] = useState<TransferUploadRecovery | null>(null);
  const [recoveryCheckStatus, setRecoveryCheckStatus] = useState<RecoveryCheckStatus>("checking");
  const [recoveryUploadedNames, setRecoveryUploadedNames] = useState<string[]>([]);
  const [recoveryCheckNonce, setRecoveryCheckNonce] = useState(0);

  /* Transfer fields */
  const [transferAction, setTransferAction] = useState<TransferAction>(
    initialAppendTransferId ? "append" : "create",
  );
  const [title, setTitle] = useState("");
  const [expiry, setExpiry] = useState("7d");
  const [appendTransferId, setAppendTransferId] = useState(initialAppendTransferId ?? "");
  const [appendOwnerToken, setAppendOwnerToken] = useState(initialAppendOwnerToken ?? "");
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);

  /* Upload progress (presigned flow) */
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  /* Drag state */
  const [isDragging, setIsDragging] = useState(false);

  /* Copy feedback */
  const [copied, setCopied] = useState<string | null>(null);

  /* Refs */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const recoveryCheckControllerRef = useRef<AbortController | null>(null);
  const deferredFiles = useDeferredValue(files);
  const fileSelectionDisabled =
    uploading ||
    Boolean(transferResult) ||
    Boolean(
      recovery &&
      (recoveryCheckStatus === "checking" ||
        recoveryCheckStatus === "finishing" ||
        recoveryCheckStatus === "discarding"),
    );

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      uploadControllerRef.current?.abort("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const saved = readTransferUploadRecovery();
    if (saved) {
      setRecovery(saved);
      setTransferAction("create");
      setTitle(saved.title);
      setExpiry(saved.expiry);
      return;
    }
    if (initialAppendTransferId) {
      setTransferAction("append");
      setAppendTransferId(initialAppendTransferId);
      setAppendOwnerToken(initialAppendOwnerToken ?? "");
      setTransferResult(null);
      return;
    }
    setTransferResult(readLastTransferResult());
  }, [initialAppendOwnerToken, initialAppendTransferId]);

  useEffect(() => {
    if (!uploading) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [uploading]);

  useEffect(() => {
    if (!uploading) return;
    const startedAt = Date.now();
    const updateElapsed = () =>
      setUploadElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [uploading]);

  const authFetch = useCallback(async (url: string | URL | Request, options: RequestInit = {}) => {
    const res = await fetch(url, options);
    if (res.status === 401) {
      window.location.assign("/upload");
    }
    return res;
  }, []);

  const authFetchWithRetry = useCallback(
    async (
      url: string,
      options: RequestInit = {},
      retries = API_REQUEST_RETRIES,
      timeoutMs = API_REQUEST_TIMEOUT_MS,
    ) =>
      fetchWithRetry(url, options, {
        retries,
        retryMethods: ["GET", "POST"],
        timeoutMs,
        request: authFetch,
      }),
    [authFetch],
  );

  useEffect(() => {
    if (!recovery || !isOnline || uploading) return;

    let cancelled = false;
    const controller = new AbortController();
    recoveryCheckControllerRef.current = controller;

    const finishRecovery = async () => {
      setRecoveryCheckStatus("finishing");
      const finalizeRes = await authFetchWithRetry(
        "/api/upload/transfer/finalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferId: recovery.transferId,
            deleteToken: recovery.deleteToken,
            title: recovery.title,
            expiresSeconds: recovery.expiresSeconds,
            files: recovery.files,
          }),
          signal: controller.signal,
        },
        API_REQUEST_RETRIES,
        API_FINALIZE_TIMEOUT_MS,
      );
      const finalizePayload = await readResponsePayload(finalizeRes);
      if (!finalizeRes.ok) {
        setRecoveryCheckStatus(finalizeRes.status === 409 ? "expired" : "unavailable");
        return;
      }
      if (cancelled) return;
      const result = finalizePayload.json as TransferResult;
      clearTransferUploadRecovery();
      setRecovery(null);
      setTransferResult(result);
      saveLastTransferResult(result);
      setFiles([]);
    };

    const releaseEmptyRecovery = async () => {
      try {
        await authFetchWithRetry("/api/upload/transfer/abandon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferId: recovery.transferId,
            deleteToken: recovery.deleteToken,
          }),
          signal: controller.signal,
        });
      } finally {
        if (!cancelled) {
          clearTransferUploadRecovery();
          setRecovery(null);
          setRecoveryUploadedNames([]);
          setFiles([]);
        }
      }
    };

    const checkRecovery = async () => {
      setRecoveryCheckStatus("checking");
      try {
        const resumeRes = await authFetchWithRetry("/api/upload/transfer/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferId: recovery.transferId,
            deleteToken: recovery.deleteToken,
            files: recovery.files,
          }),
          signal: controller.signal,
        });
        const resumePayload = await readResponsePayload(resumeRes);
        const resumeData = resumePayload.json as Partial<{
          status: "ready";
          urls: unknown[];
          uploadedNames: string[];
        }>;
        if (cancelled) return;
        if (resumeRes.status === 410) {
          // Finalization may have committed immediately before the response was lost.
          // Its endpoint is idempotent and can recover the completed transfer result.
          await finishRecovery();
          return;
        }
        if (!resumeRes.ok || resumeData.status !== "ready" || !Array.isArray(resumeData.urls)) {
          setRecoveryCheckStatus("unavailable");
          return;
        }

        const uploadedNames = Array.isArray(resumeData.uploadedNames)
          ? resumeData.uploadedNames
          : [];
        setRecoveryUploadedNames(uploadedNames);
        const storageState = getRecoveryStorageState(uploadedNames.length, resumeData.urls.length);
        if (storageState === "empty") {
          await releaseEmptyRecovery();
          return;
        }
        if (storageState === "partial") {
          setRecoveryCheckStatus("available");
          return;
        }

        await finishRecovery();
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setRecoveryCheckStatus(navigator.onLine ? "unavailable" : "available");
        }
      }
    };

    void checkRecovery();
    return () => {
      cancelled = true;
      controller.abort();
      if (recoveryCheckControllerRef.current === controller) {
        recoveryCheckControllerRef.current = null;
      }
    };
  }, [authFetchWithRetry, isOnline, recovery, recoveryCheckNonce, uploading]);

  /* ─── File management ─── */

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const arr = Array.from(newFiles);
      setFiles((prev) => {
        if (recovery) return arr;
        const seen = new Set(prev.map((file) => `${file.name}:${file.size}`));
        const next = [...prev];
        for (const file of arr) {
          const signature = `${file.name}:${file.size}`;
          if (seen.has(signature)) continue;
          seen.add(signature);
          next.push(file);
        }
        return next;
      });
      setTransferResult(null);
      if (transferAction !== "append" || !appendOwnerToken) clearLastTransferResult();
      setUploadError("");
    },
    [appendOwnerToken, recovery, transferAction],
  );

  const removeFile = useCallback((target: File) => {
    setFiles((prev) =>
      prev.filter((file) => !(file.name === target.name && file.size === target.size)),
    );
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setTransferResult(null);
    if (transferAction !== "append" || !appendOwnerToken) clearLastTransferResult();
    setUploadError("");
  }, [appendOwnerToken, transferAction]);

  const addToCompletedTransfer = (result: TransferResult) => {
    const ownerToken = getOwnerToken(result);
    if (!ownerToken && !isAdmin) {
      setUploadError("The private owner link is missing. Start a new transfer instead.");
      return;
    }
    setTransferAction("append");
    setAppendTransferId(result.transfer.id);
    setAppendOwnerToken(ownerToken ?? "");
    setFiles([]);
    setTransferResult(null);
    setUploadError("");
  };

  const startNewTransfer = () => {
    clearLastTransferResult();
    setTransferAction("create");
    setAppendTransferId("");
    setAppendOwnerToken("");
    setTitle("");
    setExpiry("7d");
    setFiles([]);
    setTransferResult(null);
    setUploadError("");
  };

  const discardRecovery = async () => {
    if (!recovery || recoveryCheckStatus === "discarding") return;
    const savedStatus = recoveryCheckStatus;
    recoveryCheckControllerRef.current?.abort("discarded");
    setRecoveryCheckStatus("discarding");
    setUploadError("");

    try {
      const response = await authFetchWithRetry("/api/upload/transfer/abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferId: recovery.transferId,
          deleteToken: recovery.deleteToken,
        }),
      });
      if (!response.ok) {
        const payload = await readResponsePayload(response);
        throw new Error(getResponseErrorMessage(payload, "Could not discard unfinished transfer"));
      }

      clearTransferUploadRecovery();
      setRecovery(null);
      setRecoveryCheckStatus("checking");
      setRecoveryUploadedNames([]);
      setFiles([]);
      setTitle("");
    } catch (error) {
      setRecoveryCheckStatus(savedStatus);
      setUploadError(
        error instanceof Error
          ? error.message
          : "Could not discard unfinished transfer. Please try again.",
      );
    }
  };

  const uploadPresignedFiles = useCallback(
    async (
      entries: Array<{
        file: File;
        url?: string;
        multipart?: PresignedMultipartUpload;
        label: string;
        contentType: string;
        onComplete?: (completion: MultipartUploadCompletion | undefined) => void;
      }>,
      signal: AbortSignal,
      initialUploadedBytes = 0,
      completeTotalBytes?: number,
    ) => {
      if (entries.length === 0) return;

      let nextIndex = 0;
      let completed = 0;
      let uploadedBytes = initialUploadedBytes;
      const reportedBytes = entries.map(() => 0);
      const attempts = entries.map(() => 1);
      const totalBytes =
        completeTotalBytes ?? entries.reduce((sum, entry) => sum + entry.file.size, 0);
      const totalAttempts = DIRECT_UPLOAD_RETRIES + 1;
      const workerCount =
        entries.length >= LARGE_BATCH_ENTRY_COUNT
          ? Math.min(LARGE_BATCH_UPLOAD_CONCURRENCY, entries.length)
          : Math.min(DIRECT_UPLOAD_CONCURRENCY, entries.length);

      setUploadProgress({
        phase: "uploading",
        current: 0,
        total: entries.length,
        uploadedBytes,
        totalBytes,
      });

      const worker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= entries.length) return;

          const entry = entries[index];
          let uploaded = false;
          let lastPutError: unknown;

          try {
            const completion = await uploadPresignedTarget(
              {
                url: entry.url,
                multipart: entry.multipart,
                body: entry.file,
                contentType: entry.contentType,
                signal,
              },
              {
                retries: DIRECT_UPLOAD_RETRIES,
                onAttempt: (attempt) => {
                  attempts[index] = attempt;
                  setUploadProgress({
                    phase: "uploading",
                    current: completed,
                    total: entries.length,
                    filename: entry.label,
                    uploadedBytes,
                    totalBytes,
                    attempt,
                    totalAttempts,
                  });
                },
                onProgress: (loaded) => {
                  const nextLoaded = Math.max(0, Math.min(entry.file.size, loaded));
                  uploadedBytes += nextLoaded - reportedBytes[index];
                  reportedBytes[index] = nextLoaded;
                  setUploadProgress({
                    phase: "uploading",
                    current: completed,
                    total: entries.length,
                    filename: entry.label,
                    uploadedBytes,
                    totalBytes,
                    attempt: attempts[index],
                    totalAttempts,
                  });
                },
                concurrency: DIRECT_UPLOAD_CONCURRENCY,
              },
            );
            entry.onComplete?.(completion);
            uploaded = true;
          } catch (error) {
            lastPutError = await toFriendlyUploadError(error, entry.file);
          }

          if (!uploaded) {
            throw buildUploadFailureMessage({
              file: entry.file,
              label: entry.label,
              contentType: entry.contentType,
              url: entry.url ?? entry.multipart?.parts[0]?.url ?? "",
              error: lastPutError,
              attempt: totalAttempts,
              totalAttempts,
            });
          }

          completed += 1;
          setUploadProgress({
            phase: "uploading",
            current: completed,
            total: entries.length,
            filename: entry.label,
            uploadedBytes,
            totalBytes,
            attempt: attempts[index],
            totalAttempts,
          });
        }
      };

      await Promise.all(Array.from({ length: workerCount }, worker));
    },
    [],
  );

  const prepareTransferUploads = useCallback(async (selectedFiles: File[]) => {
    if (BROWSER_PREP_MODE === "off") {
      const blockedFile = selectedFiles.find((file) => isHeifLikeFile(file));
      if (blockedFile) {
        throw new Error(
          `HEIC/HIF transfer uploads require browser-side conversion. Re-enable browser prep and retry ${blockedFile.name}.`,
        );
      }
      return selectedFiles.map<PreparedBrowserImage>((file) => ({
        uploadFile: file,
        uploadName: file.name,
      }));
    }

    let completed = 0;
    setUploadProgress({
      phase: "preparing",
      current: 0,
      total: selectedFiles.length,
    });

    return mapWithConcurrency(selectedFiles, BROWSER_PREP_CONCURRENCY, async (file) => {
      try {
        const prepared = await prepareBrowserImage(file, {
          archiveOriginal: true,
          derivePreview: true,
          requireBrowserDecode: true,
        });
        completed += 1;
        setUploadProgress({
          phase: "preparing",
          current: completed,
          total: selectedFiles.length,
          filename: file.name,
        });
        return prepared;
      } catch (error) {
        if (isHeifLikeFile(file)) {
          const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
          throw new Error(
            `Could not convert ${file.name} in the browser. HEIC/HIF transfer uploads require client-side conversion.${detail}`,
            { cause: error },
          );
        }
        return {
          uploadFile: file,
          uploadName: file.name,
        } satisfies PreparedBrowserImage;
      }
    });
  }, []);

  /* ─── Drag & drop ─── */

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!fileSelectionDisabled) setIsDragging(true);
    },
    [fileSelectionDisabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (fileSelectionDisabled) return;
      const droppedFiles = await collectDroppedFiles(e.dataTransfer);
      if (droppedFiles.length > 0) addFiles(droppedFiles);
    },
    [addFiles, fileSelectionDisabled],
  );

  useEffect(
    () =>
      registerApplicationFileDrop(async (dataTransfer) => {
        if (fileSelectionDisabled) return;
        const droppedFiles = await collectDroppedFiles(dataTransfer);
        if (droppedFiles.length > 0) addFiles(droppedFiles);
      }),
    [addFiles, fileSelectionDisabled],
  );

  /* ─── Paste (Ctrl+V / Cmd+V) ─── */

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (fileSelectionDisabled) return;
      // Try clipboardData.files first (direct file paste)
      const directFiles = e.clipboardData?.files;
      if (directFiles && directFiles.length > 0) {
        e.preventDefault();
        addFiles(directFiles);
        return;
      }

      // Fall back to items (screenshots, copied images)
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      const pastedFiles: File[] = [];
      let counter = Date.now();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;

        const file = item.getAsFile();
        if (!file) continue;

        // Pasted screenshots arrive as unnamed blobs — give them a name
        if (!file.name || file.name === "image.png") {
          const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
          const named = new File([file], `pasted-${counter++}.${ext}`, {
            type: file.type,
          });
          pastedFiles.push(named);
        } else {
          pastedFiles.push(file);
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        addFiles(pastedFiles);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addFiles, fileSelectionDisabled]);

  /* ─── Upload ─── */

  /** Presigned flow: browser uploads directly to R2, then tells the API to finalize. */
  const handleTransferCreateUpload = async (signal: AbortSignal) => {
    const transferTitle = inferTransferTitle(title, files);
    const selectedFiles = recovery
      ? orderSourceFilesForRecovery(files, recovery.sourceFiles)
      : files;
    if (!selectedFiles) {
      throw new Error(
        "Choose the same files shown in the interrupted upload, or discard it before starting a new transfer.",
      );
    }
    const preparedFiles = await prepareTransferUploads(selectedFiles);
    const presignFiles: TransferUploadFileInput[] = preparedFiles.map((file) => ({
      name: file.uploadName,
      size: file.uploadFile.size,
      type: file.uploadFile.type,
      ...(file.originalFile
        ? {
            originalName: file.originalFile.name,
            originalSize: file.originalFile.size,
            originalType: file.originalFile.type,
            convertedFrom: file.convertedFrom,
          }
        : {}),
    }));

    setUploadProgress({ phase: "authorizing", current: 0, total: presignFiles.length });
    let transferId: string;
    let deleteToken: string;
    let expiresSeconds: number;
    let finalizeFiles: TransferUploadFileInput[];
    let urls: Array<{
      name: string;
      mediaId?: string;
      contentType: string;
      primaryUrl?: string;
      multipart?: PresignedMultipartUpload;
      archivedOriginalUrl?: string;
    }>;
    let uploadedNames: string[] = [];

    if (recovery) {
      if (
        recovery.files.length !== presignFiles.length ||
        !presignFiles.every((file, index) => uploadMetadataMatches(file, recovery.files[index]!))
      ) {
        throw new Error(
          "The reselected files changed while being prepared. Discard the interrupted upload and start again.",
        );
      }
      const resumeRes = await authFetchWithRetry("/api/upload/transfer/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferId: recovery.transferId,
          deleteToken: recovery.deleteToken,
          files: recovery.files,
        }),
        signal,
      });
      const resumePayload = await readResponsePayload(resumeRes);
      const resumeData = resumePayload.json as Partial<{
        status: "ready";
        urls: typeof urls;
        uploadedNames: string[];
      }>;
      if (!resumeRes.ok || resumeData.status !== "ready" || !Array.isArray(resumeData.urls)) {
        throw new Error(getResponseErrorMessage(resumePayload, "Could not resume upload"));
      }
      transferId = recovery.transferId;
      deleteToken = recovery.deleteToken;
      expiresSeconds = recovery.expiresSeconds;
      finalizeFiles = recovery.files;
      urls = resumeData.urls;
      uploadedNames = Array.isArray(resumeData.uploadedNames) ? resumeData.uploadedNames : [];
    } else {
      const presignRes = await authFetchWithRetry("/api/upload/transfer/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: transferTitle, expires: expiry, files: presignFiles }),
        signal,
      });
      const presignPayload = await readResponsePayload(presignRes);
      const presignData = presignPayload.json as Partial<{
        transferId: string;
        deleteToken: string;
        expiresSeconds: number;
        urls: typeof urls;
      }>;
      if (
        !presignRes.ok ||
        typeof presignData.transferId !== "string" ||
        typeof presignData.deleteToken !== "string" ||
        typeof presignData.expiresSeconds !== "number" ||
        !Array.isArray(presignData.urls)
      ) {
        throw new Error(getResponseErrorMessage(presignPayload, "Failed to prepare upload"));
      }
      transferId = presignData.transferId;
      deleteToken = presignData.deleteToken;
      expiresSeconds = presignData.expiresSeconds;
      urls = presignData.urls;
      const mediaIdsByName = new Map(urls.map((entry) => [entry.name, entry.mediaId]));
      finalizeFiles = presignFiles.map((file) => ({
        ...file,
        mediaId: mediaIdsByName.get(file.name),
      }));
      const saved = saveTransferUploadRecovery({
        transferId,
        deleteToken,
        title: transferTitle,
        expiry,
        expiresSeconds,
        sourceFiles: files,
        files: finalizeFiles,
      });
      setRecovery(saved);
      setRecoveryUploadedNames([]);
    }

    // 2. Upload files directly to R2 (bounded parallelism for faster uploads)
    const preparedByName = new Map(preparedFiles.map((file) => [file.uploadName, file]));
    const finalizeByName = new Map(finalizeFiles.map((file) => [file.name, file]));
    const uploadEntries = urls.flatMap((entry) => {
      const prepared = preparedByName.get(entry.name);
      if (!prepared) {
        throw new Error(`Could not resolve prepared upload for ${entry.name}`);
      }
      if (prepared.originalFile && !entry.archivedOriginalUrl) {
        throw new Error(
          `Could not reserve original-file storage for ${prepared.originalFile.name}`,
        );
      }

      return [
        {
          file: prepared.uploadFile,
          url: entry.primaryUrl,
          multipart: entry.multipart,
          label: prepared.uploadFile.name,
          contentType: entry.contentType,
          onComplete: (completion: MultipartUploadCompletion | undefined) => {
            const file = finalizeByName.get(entry.name);
            if (file && completion) file.multipart = completion;
          },
        },
        ...(prepared.originalFile && entry.archivedOriginalUrl
          ? [
              {
                file: prepared.originalFile,
                url: entry.archivedOriginalUrl,
                label: prepared.originalFile.name,
                contentType: prepared.originalFile.type || "application/octet-stream",
              },
            ]
          : []),
      ];
    });
    const uploadedNameSet = new Set(uploadedNames);
    const totalBytes = finalizeFiles.reduce(
      (sum, file) => sum + file.size + (file.originalSize ?? 0),
      0,
    );
    const uploadedBytes = finalizeFiles.reduce(
      (sum, file) =>
        sum + (uploadedNameSet.has(file.name) ? file.size + (file.originalSize ?? 0) : 0),
      0,
    );
    await uploadPresignedFiles(uploadEntries, signal, uploadedBytes, totalBytes);
    const saved = saveTransferUploadRecovery({
      transferId,
      deleteToken,
      title: transferTitle,
      expiry,
      expiresSeconds,
      sourceFiles: selectedFiles,
      files: finalizeFiles,
    });
    setRecovery(saved);

    // 3. Finalize — server processes thumbnails and saves metadata
    setUploadProgress({
      phase: "processing",
      current: presignFiles.length,
      total: presignFiles.length,
    });

    const finalizeRes = await authFetchWithRetry(
      "/api/upload/transfer/finalize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferId,
          deleteToken,
          title: transferTitle,
          expiresSeconds,
          files: finalizeFiles,
        }),
        signal,
      },
      API_REQUEST_RETRIES,
      API_FINALIZE_TIMEOUT_MS,
    );

    const finalizePayload = await readResponsePayload(finalizeRes);
    if (!finalizeRes.ok) {
      throw new Error(
        getResponseErrorMessage(finalizePayload, "Upload succeeded but finalization failed"),
      );
    }

    clearTransferUploadRecovery();
    setRecovery(null);
    return finalizePayload.json as TransferResult;
  };

  const handleTransferAppendUpload = async (signal: AbortSignal) => {
    const transferId = appendTransferId.trim();
    if (!transferId) throw new Error("transfer id is required for append");
    if (!isAdmin && !appendOwnerToken) {
      throw new Error("The private owner link is required to add files to this transfer");
    }
    const preparedFiles = await prepareTransferUploads(files);
    const presignFiles: TransferUploadFileInput[] = preparedFiles.map((file) => ({
      name: file.uploadName,
      size: file.uploadFile.size,
      type: file.uploadFile.type,
      ...(file.originalFile
        ? {
            originalName: file.originalFile.name,
            originalSize: file.originalFile.size,
            originalType: file.originalFile.type,
            convertedFrom: file.convertedFrom,
          }
        : {}),
    }));

    setUploadProgress({ phase: "authorizing", current: 0, total: presignFiles.length });
    const presignRes = await authFetchWithRetry("/api/upload/transfer/append/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transferId,
        deleteToken: appendOwnerToken || undefined,
        files: presignFiles,
      }),
      signal,
    });

    const presignData = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok) {
      throw new Error(
        (presignData as { error?: string }).error || "Failed to prepare append upload",
      );
    }

    const { urls } = presignData as {
      urls: Array<{
        name: string;
        mediaId: string;
        contentType: string;
        primaryUrl?: string;
        multipart?: PresignedMultipartUpload;
        archivedOriginalUrl?: string;
      }>;
    };
    const mediaIdsByName = new Map(urls.map((entry) => [entry.name, entry.mediaId]));
    const finalizeFiles: TransferUploadFileInput[] = presignFiles.map((file) => ({
      ...file,
      mediaId: mediaIdsByName.get(file.name),
    }));

    const preparedByName = new Map(preparedFiles.map((file) => [file.uploadName, file]));
    const finalizeByName = new Map(finalizeFiles.map((file) => [file.name, file]));
    const uploadEntries = urls.flatMap((entry) => {
      const prepared = preparedByName.get(entry.name);
      if (!prepared) throw new Error(`Could not resolve prepared upload for ${entry.name}`);
      if (prepared.originalFile && !entry.archivedOriginalUrl) {
        throw new Error(
          `Could not reserve original-file storage for ${prepared.originalFile.name}`,
        );
      }
      return [
        {
          file: prepared.uploadFile,
          url: entry.primaryUrl,
          multipart: entry.multipart,
          label: prepared.uploadFile.name,
          contentType: entry.contentType,
          onComplete: (completion: MultipartUploadCompletion | undefined) => {
            const file = finalizeByName.get(entry.name);
            if (file && completion) file.multipart = completion;
          },
        },
        ...(prepared.originalFile && entry.archivedOriginalUrl
          ? [
              {
                file: prepared.originalFile,
                url: entry.archivedOriginalUrl,
                label: prepared.originalFile.name,
                contentType: prepared.originalFile.type || "application/octet-stream",
              },
            ]
          : []),
      ];
    });
    await uploadPresignedFiles(uploadEntries, signal);

    setUploadProgress({
      phase: "processing",
      current: presignFiles.length,
      total: presignFiles.length,
    });
    const finalizeRes = await authFetchWithRetry(
      "/api/upload/transfer/append/finalize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferId,
          deleteToken: appendOwnerToken || undefined,
          files: finalizeFiles,
        }),
        signal,
      },
      API_REQUEST_RETRIES,
      API_FINALIZE_TIMEOUT_MS,
    );

    const finalizePayload = await readResponsePayload(finalizeRes);
    if (!finalizeRes.ok) {
      throw new Error(
        getResponseErrorMessage(finalizePayload, "Append upload succeeded but finalization failed"),
      );
    }

    return finalizePayload.json as TransferResult;
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (
      recovery &&
      (recoveryCheckStatus !== "available" ||
        getRecoverySelectionState(files, recovery.sourceFiles) !== "matches")
    ) {
      setUploadError("Choose the original files together before continuing this transfer.");
      return;
    }

    setUploadElapsedSeconds(0);
    setUploading(true);
    setUploadError("");
    setUploadProgress(null);
    setTransferResult(null);
    const controller = new AbortController();
    uploadControllerRef.current = controller;

    try {
      const result =
        transferAction === "append"
          ? await handleTransferAppendUpload(controller.signal)
          : await handleTransferCreateUpload(controller.signal);
      setTransferResult(result);
      saveLastTransferResult(result);
      setFiles([]);
    } catch (e) {
      setUploadError(
        !navigator.onLine
          ? "connection lost · reconnect, then continue the upload"
          : controller.signal.aborted
            ? "upload paused · your files are still selected"
            : (e as Error).message || "Upload failed",
      );
    } finally {
      uploadControllerRef.current = null;
      setUploading(false);
      setUploadProgress(null);
    }
  };

  /* ─── Copy helper ─── */

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await copyText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const totalFileSize = files.reduce((sum, f) => sum + f.size, 0);
  const recoverySelectionState = recovery
    ? getRecoverySelectionState(files, recovery.sourceFiles)
    : null;
  const canContinueRecovery =
    !recovery || (recoveryCheckStatus === "available" && recoverySelectionState === "matches");
  // The route loader owns the upload authentication gate.

  /* ─── Render: Upload dashboard ─── */

  return (
    <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
      {/* Header */}
      <header className="mb-10">
        <h1 className="font-mono font-bold tracking-tighter text-lg">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">· upload</span>
        </h1>
        <nav
          className="mt-3 flex items-center gap-6 font-mono text-xs tracking-wide"
          aria-label="Site"
        >
          <Link to="/" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            home
          </Link>
          <Link
            to="/words"
            className="theme-muted hover:text-[var(--foreground)] transition-colors"
          >
            words
          </Link>
        </nav>
        {accessExpiresAt ? (
          <p
            className="mt-5 border-y theme-border py-3 font-mono text-xs theme-muted"
            role="status"
          >
            guest access is open · closes at{" "}
            {new Date(accessExpiresAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </header>

      <p className="font-mono text-xs theme-muted mb-6">
        {transferAction === "append"
          ? appendOwnerToken
            ? "add files to the same share link · its expiry stays the same"
            : "admin only — append files to an existing active transfer (expiry stays the same)"
          : "ephemeral file sharing — auto-expires after the set duration"}
      </p>

      {!isOnline && !recovery ? (
        <div className="mb-6 rounded-md border theme-border px-4 py-3" role="status">
          <p className="font-mono text-xs">offline · upload will be available when you reconnect</p>
          <p className="mt-1 font-mono text-micro theme-muted">
            selected files stay on this page; nothing is being sent right now
          </p>
        </div>
      ) : null}

      {recovery && !uploading && recoveryCheckStatus !== "checking" ? (
        <TransferRecoveryPanel
          recovery={recovery}
          checkStatus={recoveryCheckStatus}
          selectionState={recoverySelectionState ?? "missing"}
          uploadedNames={recoveryUploadedNames}
          isOnline={isOnline}
          onChooseFiles={() => fileInputRef.current?.click()}
          onContinue={() => void handleUpload()}
          onCheckAgain={() => setRecoveryCheckNonce((value) => value + 1)}
          onDiscard={() => void discardRecovery()}
        />
      ) : null}
      {recovery && !uploading && recoveryCheckStatus === "checking" ? (
        <p className="mb-6 font-mono text-xs theme-muted" role="status">
          checking whether any files from the previous upload finished…
        </p>
      ) : null}

      <div className="space-y-4 mb-6">
        {isAdmin ? (
          <p className="font-mono text-micro theme-faint">admin uploads bypass request size caps</p>
        ) : null}
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setTransferAction("create");
                setAppendOwnerToken("");
              }}
              disabled={uploading || Boolean(recovery)}
              aria-pressed={transferAction === "create"}
              className={`min-h-11 rounded border px-3 py-2 font-mono text-xs transition-colors ${
                transferAction === "create"
                  ? "border-[var(--foreground)] text-[var(--foreground)]"
                  : "theme-border theme-muted hover:text-[var(--foreground)]"
              }`}
            >
              new transfer
            </button>
            <button
              type="button"
              onClick={() => {
                setTransferAction("append");
                setAppendOwnerToken("");
              }}
              disabled={uploading || Boolean(recovery)}
              aria-pressed={transferAction === "append"}
              className={`min-h-11 rounded border px-3 py-2 font-mono text-xs transition-colors ${
                transferAction === "append"
                  ? "border-[var(--foreground)] text-[var(--foreground)]"
                  : "theme-border theme-muted hover:text-[var(--foreground)]"
              }`}
            >
              append to existing
            </button>
          </div>
        ) : null}

        {transferAction === "append" && appendOwnerToken ? (
          <div className="rounded border theme-border px-4 py-3">
            <p className="font-mono text-xs">adding to {appendTransferId}</p>
            <p className="mt-1 font-mono text-micro theme-muted">
              New files will appear on the existing share link. Existing files will stay unchanged.
            </p>
          </div>
        ) : transferAction === "append" ? (
          <div>
            <label
              htmlFor="append-transfer-id"
              className="font-mono text-xs theme-muted block mb-1.5"
            >
              transfer id
            </label>
            <input
              id="append-transfer-id"
              type="text"
              value={appendTransferId}
              onChange={(e) => setAppendTransferId(e.target.value)}
              placeholder="velvet-moon-candle"
              className="min-h-11 w-full border-b border-[var(--stone-200)] bg-transparent py-2 font-mono text-sm outline-none transition-colors placeholder:text-[var(--stone-400)] focus:border-[var(--foreground)]"
            />
            <p className="font-mono text-micro theme-faint mt-1">
              admin only · appends files without changing expiry
            </p>
          </div>
        ) : (
          <>
            <div>
              <label
                htmlFor="transfer-title"
                className="font-mono text-xs theme-muted block mb-1.5"
              >
                transfer title
              </label>
              <input
                id="transfer-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={Boolean(recovery)}
                maxLength={160}
                placeholder="valentine's day photos"
                className="min-h-11 w-full border-b border-[var(--stone-200)] bg-transparent py-2 font-mono text-sm outline-none transition-colors placeholder:text-[var(--stone-400)] focus:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="font-mono text-micro theme-faint mt-1">
                optional · a single file uses its filename by default
              </p>
            </div>
            <div>
              <label
                htmlFor="transfer-expiry"
                className="font-mono text-xs theme-muted block mb-1.5"
              >
                expires
              </label>
              <AppSelect
                id="transfer-expiry"
                value={expiry}
                onValueChange={setExpiry}
                disabled={Boolean(recovery)}
                className="w-full rounded-lg text-sm"
                options={EXPIRY_OPTIONS}
              />
            </div>
            <p className="font-mono text-micro theme-faint">
              originals stay intact; large or uncommon images get a browser-prepared working copy
              before server previews are built
            </p>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="border-t theme-border my-6" />

      {/* Drop zone */}
      <div
        data-file-drop-zone
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!fileSelectionDisabled) fileInputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (!fileSelectionDisabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={fileSelectionDisabled ? -1 : 0}
        aria-disabled={fileSelectionDisabled}
        aria-label={
          recovery
            ? "Choose the original files to continue this transfer"
            : "Choose files to upload"
        }
        className={`border rounded-lg p-10 text-center transition-colors ${
          fileSelectionDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${
          isDragging
            ? "border-[var(--prose-hashtag)] border-solid bg-[var(--selection-bg)]/20"
            : "border-dashed border-[var(--stone-300)] hover:border-[var(--stone-400)]"
        }`}
      >
        <p className="font-mono text-sm theme-muted">
          {recovery ? "choose the original files" : "drop files here"}
        </p>
        <p className="font-mono text-xs theme-faint mt-1">
          {recovery
            ? "select the full set together · your files stay on this device until you continue"
            : "click to browse · paste to add"}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={fileSelectionDisabled}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs theme-muted">
              {files.length} file{files.length !== 1 ? "s" : ""} · {formatBytes(totalFileSize)}
              <span className="theme-faint"> (direct to R2)</span>
            </span>
            <button
              type="button"
              onClick={clearAll}
              disabled={uploading}
              className="min-h-11 px-2 font-mono text-xs theme-muted transition-colors hover:text-[var(--foreground)]"
            >
              clear all
            </button>
          </div>

          <div className="space-y-0">
            {deferredFiles.map((file) => (
              <div
                key={`${file.name}-${file.size}`}
                className="flex items-center justify-between py-2 border-b border-[var(--stone-100)]"
              >
                <div className="min-w-0 flex-1 pr-4">
                  <span className="font-mono text-sm truncate block">{file.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-xs theme-muted">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(file)}
                    disabled={uploading}
                    className="inline-flex size-11 items-center justify-center text-sm leading-none theme-muted transition-colors hover:text-[var(--foreground)]"
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Upload button */}
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !isOnline || files.length === 0 || !canContinueRecovery}
            className="mh-action mh-action--primary mt-6 w-full disabled:opacity-30"
          >
            {uploading && uploadProgress
              ? `${getUploadProgressLabel(uploadProgress)}...`
              : uploading
                ? "uploading..."
                : recovery
                  ? "continue transfer"
                  : transferAction === "append"
                    ? `append ${files.length} file${files.length !== 1 ? "s" : ""}`
                    : `upload ${files.length} file${files.length !== 1 ? "s" : ""}`}
          </button>
          {uploading && uploadProgress ? (
            <div className="mt-3 rounded-md border theme-border px-4 py-3">
              <div className="flex items-center justify-between gap-3 font-mono text-xs tracking-wide">
                <span aria-live="polite">{getUploadProgressLabel(uploadProgress)}</span>
                <span className="shrink-0 theme-muted">
                  {uploadProgress.phase === "authorizing"
                    ? "connecting"
                    : uploadProgress.phase === "processing"
                      ? "final step"
                      : `${getUploadProgressPercent(uploadProgress)}%`}
                  {` · ${formatElapsed(uploadElapsedSeconds)}`}
                </span>
              </div>
              {getUploadProgressPercent(uploadProgress) !== null ? (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
                  role="progressbar"
                  aria-label={getUploadProgressLabel(uploadProgress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={getUploadProgressPercent(uploadProgress) ?? undefined}
                >
                  <div
                    className="h-full bg-[var(--foreground)] transition-[width] duration-200"
                    style={{ width: `${getUploadProgressPercent(uploadProgress)}%` }}
                  />
                </div>
              ) : uploadProgress.phase === "authorizing" ? (
                <p className="mt-2 font-mono text-[11px] theme-muted">
                  no file data has been sent yet · this step retries automatically
                </p>
              ) : (
                <p className="mt-2 font-mono text-[11px] theme-muted">
                  uploads are done. the server is building gallery previews now.
                </p>
              )}
              {uploadProgress.phase === "uploading" &&
              uploadProgress.attempt &&
              uploadProgress.attempt > 1 ? (
                <p className="mt-2 font-mono text-[11px] text-[var(--prose-hashtag)]">
                  storage stopped responding · reconnecting {uploadProgress.attempt}/
                  {uploadProgress.totalAttempts}
                </p>
              ) : null}
              {uploadProgress.filename ? (
                <p className="mt-2 truncate font-mono text-[11px] theme-muted">
                  current file: {uploadProgress.filename}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => uploadControllerRef.current?.abort()}
                className="mt-2 min-h-11 font-mono text-xs theme-muted underline underline-offset-4 transition-colors hover:text-[var(--foreground)]"
              >
                pause upload
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Error */}
      {uploadError && (
        <p className="mt-4 font-mono text-xs text-[var(--prose-hashtag)]" role="alert">
          {uploadError}
        </p>
      )}
      <ReportIssueButton
        type="upload_issue"
        payload={{
          surface: "transfer",
          phase: uploadProgress?.phase,
          operation: transferAction === "append" ? "append" : "upload",
          fileCount: files.length,
          bytes: files.reduce((total, file) => total + file.size, 0),
          errorCode: uploadError ? "upload_failed" : undefined,
          retryable: uploadError ? true : undefined,
        }}
      />

      {/* Transfer result */}
      {transferResult && (
        <div className="mt-8">
          <div className="border-t theme-border pt-6">
            <div className="mh-status mh-status--positive mb-5" role="status">
              <span className="mh-status__mark" aria-hidden="true" />
              <div>
                <p className="mh-status__label">transfer ready</p>
                <p className="mh-status__detail">
                  Send the share link. Keep the owner link private for managing or deleting files.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => copyToClipboard(transferResult.shareUrl, "share")}
                  className="mh-action mh-action--primary flex-1"
                >
                  {copied === "share" ? "share link copied" : "copy share link"}
                </button>
                <a
                  href={transferResult.shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mh-action mh-action--secondary flex-1"
                >
                  open transfer
                </a>
              </div>

              <div>
                <p className="font-mono text-xs theme-muted mb-1">share link</p>
                <a
                  href={transferResult.shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-sm hover:underline"
                >
                  {transferResult.shareUrl}
                </a>
              </div>

              <div>
                <p className="font-mono text-xs theme-muted mb-1">private owner link</p>
                <div className="flex items-center gap-2">
                  <a
                    href={transferResult.adminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm flex-1 truncate hover:underline"
                  >
                    {transferResult.adminUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(transferResult.adminUrl, "admin")}
                    className="min-h-11 shrink-0 px-2 font-mono text-xs theme-muted transition-colors hover:text-[var(--foreground)]"
                  >
                    {copied === "admin" ? "copied" : "copy"}
                  </button>
                </div>
              </div>

              <p className="font-mono text-micro theme-faint">
                anyone with the owner link can manage or delete this transfer. it stays available
                after a refresh in this tab only.
              </p>

              <p className="font-mono text-xs theme-muted pt-2">
                {transferResult.transfer.fileCount} file
                {transferResult.transfer.fileCount !== 1 ? "s" : ""} ·{" "}
                {formatBytes(transferResult.transferTotalSize ?? transferResult.totalSize)} ·
                expires{" "}
                {new Date(transferResult.transfer.expiresAt).toLocaleDateString("en-GB", {
                  timeZone: "Europe/London",
                })}
              </p>
              {typeof transferResult.addedCount === "number" ? (
                <p className="font-mono text-xs theme-muted">
                  added {transferResult.addedCount} file{transferResult.addedCount === 1 ? "" : "s"}{" "}
                  to existing transfer
                </p>
              ) : null}
              {transferResult.processingCounts ? (
                <p className="font-mono text-xs theme-muted">
                  {transferResult.processingCounts.readyCount} ready
                  {transferResult.processingCounts.queuedCount > 0
                    ? ` · ${transferResult.processingCounts.queuedCount} processing`
                    : ""}
                  {transferResult.processingCounts.failedCount > 0
                    ? ` · ${transferResult.processingCounts.failedCount} failed`
                    : ""}
                  {transferResult.processingCounts.originalOnlyCount > 0
                    ? ` · ${transferResult.processingCounts.originalOnlyCount} original-only`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => addToCompletedTransfer(transferResult)}
            className="mh-action mh-action--primary mt-6 w-full"
          >
            add more to this transfer
          </button>
          <button
            type="button"
            onClick={startNewTransfer}
            className="mh-action mh-action--secondary mt-3 w-full"
          >
            start a new transfer
          </button>
          <p className="mt-2 font-mono text-micro theme-faint">
            Adding more keeps this link and expiry. Starting new creates a separate share link.
          </p>
        </div>
      )}

      <footer className="border-t theme-border mt-16 pt-8">
        <div className="flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <Link to="/" className="hover:text-[var(--foreground)] transition-colors">
            ← home
          </Link>
          <span>
            © {new Date().getFullYear()} {SITE_BRAND}
          </span>
        </div>
      </footer>
    </div>
  );
}
