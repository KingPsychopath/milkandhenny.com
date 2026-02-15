"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { getStored, setStored, removeStored } from "@/lib/storage-keys";
import { SITE_BRAND } from "@/lib/config";

/* ─── Types ─── */

type UploadMode = "transfer" | "blog";

type TransferResult = {
  shareUrl: string;
  adminUrl: string;
  transfer: {
    id: string;
    title: string;
    fileCount: number;
    expiresAt: string;
  };
  totalSize: number;
  fileCounts: {
    images: number;
    videos: number;
    gifs: number;
    audio: number;
    other: number;
  };
};

type BlogUploadedFile = {
  original: string;
  filename: string;
  kind: string;
  width?: number;
  height?: number;
  size: number;
  markdown: string;
  overwrote: boolean;
};

type BlogResult = {
  uploaded: BlogUploadedFile[];
  skipped: string[];
};

/* ─── Helpers ─── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 b";
  const k = 1024;
  const sizes = ["b", "kb", "mb", "gb"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Fallback limit for the legacy direct-upload path (Vercel body limit is 4.5 MB) */
const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;

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

export function UploadDashboard() {
  const [mounted, setMounted] = useState(false);
  const [pin, setPin] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  /** Read token after mount only — avoids hydration mismatch (no sessionStorage on server). */
  useEffect(() => {
    const stored = getStored("uploadToken") ?? "";
    setUploadToken(stored);
    setIsAuthed(!!stored);
    setMounted(true);
  }, []);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* Upload state */
  const [mode, setMode] = useState<UploadMode>("transfer");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  /* Transfer fields */
  const [title, setTitle] = useState("");
  const [expiry, setExpiry] = useState("7d");
  const [transferResult, setTransferResult] = useState<TransferResult | null>(
    null
  );

  /* Blog fields */
  const [slug, setSlug] = useState("");
  const [force, setForce] = useState(false);
  const [blogResult, setBlogResult] = useState<BlogResult | null>(null);

  /* Upload progress (presigned flow) */
  const [uploadProgress, setUploadProgress] = useState<{
    phase: "uploading" | "processing";
    current: number;
    total: number;
    filename?: string;
  } | null>(null);

  /* Drag state */
  const [isDragging, setIsDragging] = useState(false);

  /* Copy feedback */
  const [copied, setCopied] = useState<string | null>(null);

  /* Refs */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Auth ─── */

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const res = await fetch("/api/upload/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setStored("uploadToken", data.token);
        setUploadToken(data.token);
        setIsAuthed(true);
      } else {
        removeStored("uploadToken");
        setAuthError("invalid pin");
      }
    } catch {
      setAuthError("connection error");
    } finally {
      setAuthLoading(false);
    }
  };

  /* ─── File management ─── */

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => [
      ...prev,
      ...arr.filter(
        (f) => !prev.some((p) => p.name === f.name && p.size === f.size)
      ),
    ]);
    setUploadError("");
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setTransferResult(null);
    setBlogResult(null);
    setUploadError("");
  }, []);

  /* ─── Drag & drop ─── */

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  /* ─── Paste (Ctrl+V / Cmd+V) ─── */

  useEffect(() => {
    if (!isAuthed) return;

    const handlePaste = (e: ClipboardEvent) => {
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
          const ext =
            file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
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
  }, [isAuthed, addFiles]);

  /* ─── Upload ─── */

  /** Presigned flow: browser uploads directly to R2, then tells the API to finalize. */
  const handleTransferUpload = async () => {
    const authHeaders = {
      Authorization: `Bearer ${uploadToken}`,
      "Content-Type": "application/json",
    };

    // 1. Get presigned PUT URLs
    setUploadProgress({ phase: "uploading", current: 0, total: files.length });
    const presignRes = await fetch("/api/upload/transfer/presign", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: title || "untitled",
        expires: expiry,
        files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    const presignData = await presignRes.json();
    if (!presignRes.ok) {
      throw new Error(presignData.error || "Failed to prepare upload");
    }

    const { transferId, deleteToken, expiresSeconds, urls } = presignData as {
      transferId: string;
      deleteToken: string;
      expiresSeconds: number;
      urls: Array<{ name: string; url: string }>;
    };

    // 2. Upload each file directly to R2 (bypasses Vercel entirely)
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({
        phase: "uploading",
        current: i + 1,
        total: files.length,
        filename: files[i].name,
      });

      const putRes = await fetch(urls[i].url, {
        method: "PUT",
        headers: { "Content-Type": files[i].type || "application/octet-stream" },
        body: files[i],
      });

      if (!putRes.ok) {
        throw new Error(`Failed to upload ${files[i].name} (${putRes.status})`);
      }
    }

    // 3. Finalize — server processes thumbnails and saves metadata
    setUploadProgress({
      phase: "processing",
      current: files.length,
      total: files.length,
    });

    const finalizeRes = await fetch("/api/upload/transfer/finalize", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        transferId,
        deleteToken,
        title: title || "untitled",
        expiresSeconds,
        files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    const finalizeData = await finalizeRes.json();
    if (!finalizeRes.ok) {
      throw new Error(
        finalizeData.error || "Upload succeeded but finalization failed"
      );
    }

    return finalizeData as TransferResult;
  };

  /** Legacy direct upload for blog mode (still uses FormData through Vercel). */
  const handleBlogUpload = async () => {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_DIRECT_UPLOAD_BYTES) {
      throw new Error(
        `Total size over ${formatBytes(MAX_DIRECT_UPLOAD_BYTES)}. Use the CLI for larger uploads.`
      );
    }

    const formData = new FormData();
    if (!slug.trim()) throw new Error("slug is required");
    formData.append("slug", slug.trim());
    if (force) formData.append("force", "true");
    for (const file of files) formData.append("files", file);

    const res = await fetch("/api/upload/blog", {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadToken}` },
      body: formData,
    });

    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch {
      /* 413 etc. may return non-JSON body */
    }

    if (!res.ok) {
      const message =
        res.status === 413
          ? `Total size over ${formatBytes(MAX_DIRECT_UPLOAD_BYTES)}. Use the CLI for larger uploads.`
          : (data.error as string) || `upload failed (${res.status})`;
      throw new Error(message);
    }

    return data as BlogResult;
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setUploadError("");
    setUploadProgress(null);
    setTransferResult(null);
    setBlogResult(null);

    try {
      if (mode === "transfer") {
        const result = await handleTransferUpload();
        setTransferResult(result);
      } else {
        const result = await handleBlogUpload();
        setBlogResult(result);
      }
      setFiles([]);
    } catch (e) {
      setUploadError((e as Error).message || "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  /* ─── Copy helper ─── */

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  /* ─── Switch mode ─── */

  const switchMode = (newMode: UploadMode) => {
    setMode(newMode);
    setUploadError("");
    setTransferResult(null);
    setBlogResult(null);
  };

  const totalFileSize = files.reduce((sum, f) => sum + f.size, 0);

  /* ─── Render: wait for mount (avoids hydration mismatch) ─── */
  if (!mounted) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" aria-busy="true" aria-label="Loading">
        <div className="w-8 h-8 border-2 border-[var(--foreground)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ─── Render: PIN gate ─── */
  if (!isAuthed) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <form onSubmit={handleAuth} className="w-full max-w-xs text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">
            milk & henny
          </h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-8">upload</p>

          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="enter pin"
            autoFocus
            className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)]"
          />

          {authError && (
            <p className="font-mono text-xs mt-3 text-[var(--prose-hashtag)]">
              {authError}
            </p>
          )}

          <button
            type="submit"
            disabled={!pin || authLoading}
            className="mt-6 w-full bg-[var(--foreground)] text-[var(--background)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {authLoading ? "checking..." : "unlock"}
          </button>

          <p className="mt-8 font-mono text-xs theme-muted">
            <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
              ← home
            </Link>
          </p>
        </form>
      </div>
    );
  }

  /* ─── Render: Upload dashboard ─── */

  return (
    <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
      {/* Header */}
      <header className="mb-10">
        <h1 className="font-mono font-bold tracking-tighter text-lg">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">· upload</span>
        </h1>
        <nav className="mt-3 flex items-center gap-6 font-mono text-xs tracking-wide" aria-label="Site">
          <Link href="/" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            home
          </Link>
          <Link href="/blog" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            words
          </Link>
        </nav>
      </header>

      {/* Mode toggle */}
      <div className="flex gap-6 mb-8">
        <button
          onClick={() => switchMode("transfer")}
          className={`font-mono text-sm lowercase tracking-wide pb-1 border-b-2 transition-colors ${
            mode === "transfer"
              ? "border-[var(--foreground)]"
              : "border-transparent theme-muted hover:text-[var(--foreground)]"
          }`}
        >
          transfer
        </button>
        <button
          onClick={() => switchMode("blog")}
          className={`font-mono text-sm lowercase tracking-wide pb-1 border-b-2 transition-colors ${
            mode === "blog"
              ? "border-[var(--foreground)]"
              : "border-transparent theme-muted hover:text-[var(--foreground)]"
          }`}
        >
          blog
        </button>
      </div>

      {/* Mode description */}
      <p className="font-mono text-xs theme-muted mb-6">
        {mode === "transfer"
          ? "ephemeral file sharing — auto-expires after the set duration"
          : "permanent blog media — uploaded to the post's slug folder"}
      </p>

      {/* Form fields */}
      {mode === "transfer" ? (
        <div className="space-y-4 mb-6">
          <div>
            <label className="font-mono text-xs theme-muted block mb-1.5">
              title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="valentine's day photos"
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm py-2 transition-colors placeholder:text-[var(--stone-400)]"
            />
          </div>
          <div>
            <label className="font-mono text-xs theme-muted block mb-1.5">
              expires
            </label>
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full bg-[var(--background)] border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm py-2 transition-colors cursor-pointer"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  className="bg-[var(--background)] text-[var(--foreground)]"
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          <div>
            <label className="font-mono text-xs theme-muted block mb-1.5">
              slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="valentine-photoshoot"
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm py-2 transition-colors placeholder:text-[var(--stone-400)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setForce(!force)}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                force
                  ? "bg-[var(--foreground)] border-[var(--foreground)]"
                  : "border-[var(--stone-300)] group-hover:border-[var(--stone-400)]"
              }`}
            >
              {force && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="var(--background)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1.5 5.5L4 8L8.5 2" />
                </svg>
              )}
            </span>
            <span className="font-mono text-xs theme-muted">
              overwrite existing files
            </span>
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="border-t theme-border my-6" />

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-[var(--prose-hashtag)] border-solid bg-[var(--selection-bg)]/20"
            : "border-dashed border-[var(--stone-300)] hover:border-[var(--stone-400)]"
        }`}
      >
        <p className="font-mono text-sm theme-muted">drop files here</p>
        <p className="font-mono text-xs theme-faint mt-1">
          click to browse · paste to add
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
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
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs theme-muted">
              {files.length} file{files.length !== 1 ? "s" : ""} ·{" "}
              {formatBytes(totalFileSize)}
              {mode === "transfer" && (
                <span className="theme-faint"> (direct to R2)</span>
              )}
              {mode === "blog" && (
                <span className="theme-faint">
                  {" "}
                  (max {formatBytes(MAX_DIRECT_UPLOAD_BYTES)})
                </span>
              )}
            </span>
            <button
              onClick={clearAll}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
            >
              clear all
            </button>
          </div>

          <div className="space-y-0">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${file.size}`}
                className="flex items-center justify-between py-2 border-b border-[var(--stone-100)]"
              >
                <span className="font-mono text-sm truncate pr-4 flex-1">
                  {file.name}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-xs theme-muted">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    onClick={() => removeFile(i)}
                    className="theme-muted hover:text-[var(--foreground)] transition-colors text-sm leading-none"
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
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="mt-6 w-full bg-[var(--foreground)] text-[var(--background)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {uploading && uploadProgress
              ? uploadProgress.phase === "processing"
                ? "processing thumbnails..."
                : `uploading ${uploadProgress.current}/${uploadProgress.total}...`
              : uploading
                ? "uploading..."
                : `upload ${files.length} file${files.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* Error */}
      {uploadError && (
        <p className="font-mono text-xs mt-4 text-[var(--prose-hashtag)]">
          {uploadError}
        </p>
      )}

      {/* Transfer result */}
      {transferResult && (
        <div className="mt-8">
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-4">result</p>

            <div className="space-y-4">
              <div>
                <p className="font-mono text-xs theme-muted mb-1">share</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm flex-1 truncate">
                    {transferResult.shareUrl}
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(transferResult.shareUrl, "share")
                    }
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                  >
                    {copied === "share" ? "copied" : "copy"}
                  </button>
                </div>
              </div>

              <div>
                <p className="font-mono text-xs theme-muted mb-1">admin</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm flex-1 truncate">
                    {transferResult.adminUrl}
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(transferResult.adminUrl, "admin")
                    }
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                  >
                    {copied === "admin" ? "copied" : "copy"}
                  </button>
                </div>
              </div>

              <p className="font-mono text-xs theme-muted pt-2">
                {transferResult.transfer.fileCount} file
                {transferResult.transfer.fileCount !== 1 ? "s" : ""} ·{" "}
                {formatBytes(transferResult.totalSize)} · expires{" "}
                {new Date(
                  transferResult.transfer.expiresAt
                ).toLocaleDateString()}
              </p>
            </div>
          </div>

          <button
            onClick={clearAll}
            className="mt-6 w-full border border-[var(--stone-200)] text-[var(--foreground)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:border-[var(--stone-400)] transition-colors"
          >
            upload more
          </button>
        </div>
      )}

      {/* Blog result */}
      {blogResult && (
        <div className="mt-8">
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-4">result</p>

            {blogResult.uploaded.length > 0 && (
              <div className="space-y-3">
                {blogResult.uploaded.map((file) => (
                  <div
                    key={file.filename}
                    className="border-b border-[var(--stone-100)] pb-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{file.filename}</span>
                      {file.width && file.height && (
                        <span className="font-mono text-xs theme-muted">
                          {file.width}×{file.height}
                        </span>
                      )}
                      {file.overwrote && (
                        <span className="font-mono text-xs text-[var(--prose-hashtag)]">
                          overwrote
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="font-mono text-xs theme-muted flex-1 truncate">
                        {file.markdown}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(file.markdown, file.filename)
                        }
                        className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                      >
                        {copied === file.filename ? "copied" : "copy"}
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() =>
                    copyToClipboard(
                      blogResult.uploaded.map((f) => f.markdown).join("\n"),
                      "all-markdown"
                    )
                  }
                  className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                >
                  {copied === "all-markdown"
                    ? "copied all"
                    : "copy all markdown"}
                </button>
              </div>
            )}

            {blogResult.skipped.length > 0 && (
              <div className="mt-4">
                <p className="font-mono text-xs theme-muted mb-1">
                  skipped ({blogResult.skipped.length})
                </p>
                <p className="font-mono text-xs theme-faint">
                  {blogResult.skipped.join(", ")}
                </p>
              </div>
            )}
          </div>

          <button
            onClick={clearAll}
            className="mt-6 w-full border border-[var(--stone-200)] text-[var(--foreground)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:border-[var(--stone-400)] transition-colors"
          >
            upload more
          </button>
        </div>
      )}

      <footer role="contentinfo" className="border-t theme-border mt-16 pt-8">
        <div className="flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
            ← home
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
