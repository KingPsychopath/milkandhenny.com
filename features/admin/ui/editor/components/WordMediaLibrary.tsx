"use client";

import { useEffect, useRef, useState } from "react";
import { uploadPresignedObject } from "@/lib/client/presigned-upload";
import type { WordMediaItem } from "../types";
import { AdminStatus } from "../../components/AdminStatus";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 b";
  const units = ["b", "kb", "mb", "gb"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

type WordMediaLibraryProps = {
  selectedSlug: string;
  mediaSearchQuery: string;
  mediaLoading: boolean;
  mediaError: string;
  mediaCopied: string | null;
  filteredPageMedia: WordMediaItem[];
  filteredSharedAssets: WordMediaItem[];
  onMediaSearchQueryChange: (value: string) => void;
  onRefresh: () => void;
  onPreview: (items: WordMediaItem[], key: string) => void;
  onCopySnippet: (snippet: string, copyId: string) => void;
  onAppendSnippet: (snippet: string) => void;
};

type PendingUploadTarget = { scope: "word"; slug: string } | { scope: "asset"; assetId: string };

type WordsPresignResponse = {
  success: true;
  urls: Array<{
    original: string;
    filename: string;
    uploadKey: string;
    url: string;
    contentType: string;
    kind: string;
    overwrote: boolean;
  }>;
  skipped: string[];
};

type WordsFinalizeResponse = {
  uploaded: Array<{ markdown: string }>;
  skipped: string[];
  queuedCount?: number;
};

const DIRECT_UPLOAD_CONCURRENCY = 4;
const DIRECT_UPLOAD_RETRIES = 2;
const API_REQUEST_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(attempt: number): number {
  return 300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
}

export function WordMediaLibrary({
  selectedSlug,
  mediaSearchQuery,
  mediaLoading,
  mediaError,
  mediaCopied,
  filteredPageMedia,
  filteredSharedAssets,
  onMediaSearchQueryChange,
  onRefresh,
  onPreview,
  onCopySnippet,
  onAppendSnippet,
}: WordMediaLibraryProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [assetUploadId, setAssetUploadId] = useState("");
  const [autoAppendUploaded, setAutoAppendUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTargetRef = useRef<PendingUploadTarget | null>(null);

  useEffect(() => {
    if (assetUploadId.trim()) return;
    const firstAsset = filteredSharedAssets.find((item) => item.assetId)?.assetId;
    if (firstAsset) setAssetUploadId(firstAsset);
  }, [assetUploadId, filteredSharedAssets]);

  const authFetchWithRetry = async (
    url: string,
    options: RequestInit,
    retries = API_REQUEST_RETRIES,
  ): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const res = await fetch(url, options);
        if (res.ok || !isRetryableStatus(res.status) || attempt > retries) return res;
      } catch (error) {
        lastError = error;
        if (attempt > retries) throw error;
      }
      await sleep(retryDelayMs(attempt));
    }
    throw lastError instanceof Error ? lastError : new Error("Request failed");
  };

  const uploadPresignedFiles = async (
    entries: Array<{ file: File; url: string; contentType: string }>,
  ) => {
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= entries.length) return;
        const entry = entries[index];
        const putRes = await uploadPresignedObject(
          {
            url: entry.url,
            body: entry.file,
            contentType: entry.contentType,
          },
          { retries: DIRECT_UPLOAD_RETRIES },
        );
        if (!putRes.ok) throw new Error(`Failed to upload ${entry.file.name} (${putRes.status})`);
      }
    };

    const workerCount = Math.min(DIRECT_UPLOAD_CONCURRENCY, entries.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  };

  const startUploadPicker = (target: PendingUploadTarget) => {
    if (uploading) return;
    pendingTargetRef.current = target;
    fileInputRef.current?.click();
  };

  const handlePickedFiles = async (fileList: FileList | null) => {
    const target = pendingTargetRef.current;
    pendingTargetRef.current = null;
    if (!target || !fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    setUploading(true);
    setUploadError("");
    setUploadStatus(`preparing ${files.length} file${files.length === 1 ? "" : "s"}...`);

    try {
      const presignRes = await authFetchWithRetry("/api/upload/words/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: target.scope,
          slug: target.scope === "word" ? target.slug : undefined,
          assetId: target.scope === "asset" ? target.assetId : undefined,
          force: false,
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });
      const presignData = (await presignRes
        .json()
        .catch(() => ({}))) as Partial<WordsPresignResponse> & { error?: string };
      if (!presignRes.ok || presignData.success !== true || !Array.isArray(presignData.urls)) {
        throw new Error(presignData.error || "Failed to prepare media upload");
      }

      const filesByName = new Map<string, File[]>();
      for (const file of files) {
        const bucket = filesByName.get(file.name);
        if (bucket) bucket.push(file);
        else filesByName.set(file.name, [file]);
      }

      const uploadEntries = presignData.urls.map((entry) => {
        const bucket = filesByName.get(entry.original);
        const file = bucket?.shift();
        if (!file) throw new Error(`Could not resolve local file for ${entry.original}`);
        return { file, url: entry.url, contentType: entry.contentType };
      });

      setUploadStatus(
        `uploading ${uploadEntries.length} file${uploadEntries.length === 1 ? "" : "s"}...`,
      );
      await uploadPresignedFiles(uploadEntries);

      setUploadStatus("processing uploads...");
      const finalizeRes = await authFetchWithRetry("/api/upload/words/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: target.scope,
          slug: target.scope === "word" ? target.slug : undefined,
          assetId: target.scope === "asset" ? target.assetId : undefined,
          skipped: presignData.skipped ?? [],
          files: presignData.urls.map((u) => ({
            original: u.original,
            filename: u.filename,
            uploadKey: u.uploadKey,
            kind: u.kind,
            size: files.find((f) => f.name === u.original)?.size ?? 0,
            overwrote: u.overwrote,
          })),
        }),
      });
      const finalizeData = (await finalizeRes
        .json()
        .catch(() => ({}))) as Partial<WordsFinalizeResponse> & { error?: string };
      if (!finalizeRes.ok || !Array.isArray(finalizeData.uploaded)) {
        throw new Error(finalizeData.error || "Upload succeeded but media finalization failed");
      }

      if (autoAppendUploaded && finalizeData.uploaded.length > 0) {
        const snippets = finalizeData.uploaded.map((u) => u.markdown).join("\n\n");
        onAppendSnippet(snippets);
      }

      await Promise.resolve(onRefresh());
      setUploadStatus(
        `uploaded ${finalizeData.uploaded.length} file${finalizeData.uploaded.length === 1 ? "" : "s"}${
          autoAppendUploaded && finalizeData.uploaded.length > 0 ? " · snippets appended" : ""
        }${
          (finalizeData.queuedCount ?? 0) > 0
            ? ` · ${finalizeData.queuedCount} queued for processing`
            : ""
        }`,
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Media upload failed");
      setUploadStatus("");
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="h-fit max-h-[720px] space-y-4 overflow-auto rounded-md border theme-border p-4 xl:sticky xl:top-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-xs theme-muted">media library</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-2 font-mono text-xs underline"
            onClick={onRefresh}
            disabled={uploading}
          >
            refresh
          </button>
        </div>
      </div>
      <div className="space-y-3 rounded border theme-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded border theme-border px-3 font-mono text-xs disabled:opacity-50"
            disabled={uploading || !selectedSlug}
            onClick={() => startUploadPicker({ scope: "word", slug: selectedSlug })}
            title={selectedSlug ? `Upload to words/media/${selectedSlug}/` : "Select a word first"}
          >
            upload to this page
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded border theme-border px-3 font-mono text-xs disabled:opacity-50"
            disabled={uploading || !assetUploadId.trim()}
            onClick={() =>
              startUploadPicker({ scope: "asset", assetId: assetUploadId.trim().toLowerCase() })
            }
            title="Upload to shared assets"
          >
            upload to shared assets
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="shared-asset-id" className="font-mono text-micro theme-faint shrink-0">
            asset id
          </label>
          <input
            id="shared-asset-id"
            value={assetUploadId}
            onChange={(event) => setAssetUploadId(event.target.value)}
            placeholder="brand-kit"
            className="min-h-11 min-w-0 flex-1 bg-transparent border-b theme-border outline-none font-mono text-xs py-2"
          />
        </div>
        <label className="flex items-center gap-2 font-mono text-micro theme-faint cursor-pointer">
          <input
            type="checkbox"
            checked={autoAppendUploaded}
            onChange={(event) => setAutoAppendUploaded(event.target.checked)}
          />
          append uploaded snippets to editor
        </label>
        {uploadStatus ? (
          <p className="font-mono text-micro" role="status">
            <AdminStatus tone={uploading ? "attention" : "positive"}>{uploadStatus}</AdminStatus>
          </p>
        ) : null}
        {uploadError ? (
          <p className="font-mono text-micro" role="alert">
            <AdminStatus tone="danger">{uploadError}</AdminStatus>
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handlePickedFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <input
        value={mediaSearchQuery}
        onChange={(event) => onMediaSearchQueryChange(event.target.value)}
        placeholder="search files or asset id"
        className="min-h-11 w-full bg-transparent border-b theme-border outline-none font-mono text-xs py-2"
      />
      {mediaLoading ? (
        <p className="font-mono text-xs" role="status">
          <AdminStatus tone="attention">loading media...</AdminStatus>
        </p>
      ) : null}
      {mediaError ? (
        <p className="font-mono text-xs" role="alert">
          <AdminStatus tone="danger">{mediaError}</AdminStatus>
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="font-mono text-xs theme-muted">this page ({filteredPageMedia.length})</p>
        {filteredPageMedia.length === 0 ? (
          <p className="font-mono text-micro theme-faint">no media files for this slug</p>
        ) : (
          filteredPageMedia.map((item) => (
            <div key={item.key} className="space-y-2 rounded border theme-border p-3">
              <p className="font-mono text-xs truncate">{item.filename}</p>
              <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
              <code className="font-mono text-micro theme-muted block truncate">
                {item.markdown}
              </code>
              <p
                className="font-mono text-[10px] theme-faint"
                title="Canonical paths are recommended. Short media references are normalized when word markdown is saved."
              >
                use canonical snippet
              </p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-micro">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onPreview(filteredPageMedia, item.key)}
                  title="Preview in-page"
                >
                  preview
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  title="Open media file in a new tab"
                >
                  open
                </a>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onCopySnippet(item.markdown, `media-${item.key}`)}
                >
                  {mediaCopied === `media-${item.key}` ? "copied" : "copy"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onAppendSnippet(item.markdown)}
                >
                  append
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="font-mono text-xs theme-muted">
          shared assets ({filteredSharedAssets.length})
        </p>
        {filteredSharedAssets.length === 0 ? (
          <p className="font-mono text-micro theme-faint">no shared assets yet</p>
        ) : (
          filteredSharedAssets.map((item) => (
            <div key={item.key} className="space-y-2 rounded border theme-border p-3">
              <p className="font-mono text-xs truncate">
                {item.assetId ? `${item.assetId}/` : ""}
                {item.filename}
              </p>
              <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
              <code className="font-mono text-micro theme-muted block truncate">
                {item.markdown}
              </code>
              <p
                className="font-mono text-[10px] theme-faint"
                title="Canonical paths are recommended. Short media references are normalized when word markdown is saved."
              >
                use canonical snippet
              </p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-micro">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onPreview(filteredSharedAssets, item.key)}
                  title="Preview in-page"
                >
                  preview
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  title="Open asset in a new tab"
                >
                  open
                </a>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onCopySnippet(item.markdown, `asset-${item.key}`)}
                >
                  {mediaCopied === `asset-${item.key}` ? "copied" : "copy"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center px-1 underline"
                  onClick={() => onAppendSnippet(item.markdown)}
                >
                  append
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
