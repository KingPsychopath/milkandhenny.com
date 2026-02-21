"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { getStored, removeStored } from "@/lib/client/storage";
import { SITE_BRAND } from "@/lib/shared/config";

/* ─── Types ─── */

type UploadMode = "transfer" | "words";
type WordsScope = "word" | "asset";

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

type WordUploadedFile = {
  original: string;
  filename: string;
  kind: string;
  width?: number;
  height?: number;
  size: number;
  markdown: string;
  overwrote: boolean;
};

type WordResult = {
  uploaded: WordUploadedFile[];
  skipped: string[];
};

type WordUploadTargetsResponse = {
  slugs: string[];
  assets: string[];
};

/* ─── Helpers ─── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 b";
  const k = 1024;
  const sizes = ["b", "kb", "mb", "gb"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function markdownLabelFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function shortWordSnippet(filename: string, kind: string): string {
  const label = markdownLabelFromFilename(filename);
  const path = `/${filename}`;
  if (kind === "image" || kind === "video" || kind === "gif") {
    return `![${label}](${path})`;
  }
  return `[${label}](${path})`;
}

function shortAssetSnippet(assetId: string, filename: string, kind: string): string {
  const label = markdownLabelFromFilename(filename);
  const path = `assets/${assetId}/${filename}`;
  if (kind === "image" || kind === "video" || kind === "gif") {
    return `![${label}](${path})`;
  }
  return `[${label}](${path})`;
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
};

const DIRECT_UPLOAD_CONCURRENCY = 4;

export function UploadDashboard({ isAdmin }: UploadDashboardProps) {
  const [mounted, setMounted] = useState(false);
  const [uploadToken, setUploadToken] = useState("");
  const [adminToken, setAdminToken] = useState("");

  /** Read token after mount only — avoids hydration mismatch (no sessionStorage on server). */
  useEffect(() => {
    const storedUpload = getStored("uploadToken") ?? "";
    const storedAdmin = getStored("adminToken") ?? "";
    setUploadToken(storedUpload);
    setAdminToken(storedAdmin);
    setMounted(true);
  }, []);

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

  /* Words fields */
  const [wordsScope, setWordsScope] = useState<WordsScope>("word");
  const [slug, setSlug] = useState("");
  const [assetId, setAssetId] = useState("");
  const [force, setForce] = useState(false);
  const [wordsResult, setWordsResult] = useState<WordResult | null>(null);
  const [wordSlugSuggestions, setWordSlugSuggestions] = useState<string[]>([]);
  const [assetSuggestions, setAssetSuggestions] = useState<string[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsResolved, setTargetsResolved] = useState(false);
  const [targetsError, setTargetsError] = useState("");

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

  const effectiveToken =
    mode === "words"
      ? adminToken
      : uploadToken || adminToken;
  // Auth gate is enforced server-side in `app/(utility)/upload/page.tsx`.
  // This component should work with cookie auth even when no local token exists.
  const isAuthed = true;

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers as Record<string, string>),
          ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
        },
      });
      if (res.status === 401) {
        // Clear the token that was actually being used so the user can re-auth.
        if (uploadToken) {
          removeStored("uploadToken");
          setUploadToken("");
        } else if (adminToken) {
          removeStored("adminToken");
          setAdminToken("");
        } else {
          // Cookie session is missing/expired. Force the server auth gate.
          window.location.assign("/upload");
        }
      }
      return res;
    },
    [adminToken, effectiveToken, uploadToken]
  );

  useEffect(() => {
    if (!isAdmin || mode !== "words" || targetsResolved || targetsLoading) return;
    let cancelled = false;
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 4500);
    const hardStop = setTimeout(() => {
      if (cancelled) return;
      setTargetsLoading(false);
      setTargetsResolved(true);
      setTargetsError("suggestions unavailable right now");
    }, 5500);

    const loadTargets = async () => {
      setTargetsLoading(true);
      setTargetsError("");
      try {
        const res = await authFetch("/api/upload/words/targets", { signal: controller.signal });
        if (!res.ok) {
          setTargetsError("couldn't load suggestions");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as Partial<WordUploadTargetsResponse>;
        if (cancelled) return;
        setWordSlugSuggestions(Array.isArray(data.slugs) ? data.slugs : []);
        setAssetSuggestions(Array.isArray(data.assets) ? data.assets : []);
      } catch {
        if (!cancelled) setTargetsError("suggestions unavailable right now");
      } finally {
        clearTimeout(abortTimeout);
        clearTimeout(hardStop);
        if (!cancelled) {
          setTargetsLoading(false);
          setTargetsResolved(true);
        }
      }
    };

    void loadTargets();
    return () => {
      clearTimeout(abortTimeout);
      clearTimeout(hardStop);
      controller.abort();
      cancelled = true;
    };
  }, [authFetch, isAdmin, mode, targetsResolved, targetsLoading]);

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
    setWordsResult(null);
    setUploadError("");
  }, []);

  const uploadPresignedFiles = useCallback(
    async (entries: Array<{ file: File; url: string }>) => {
      if (entries.length === 0) return;

      let nextIndex = 0;
      let completed = 0;

      const worker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= entries.length) return;

          const entry = entries[index];
          const putRes = await fetch(entry.url, {
            method: "PUT",
            headers: { "Content-Type": entry.file.type || "application/octet-stream" },
            body: entry.file,
          });

          if (!putRes.ok) {
            throw new Error(`Failed to upload ${entry.file.name} (${putRes.status})`);
          }

          completed += 1;
          setUploadProgress({
            phase: "uploading",
            current: completed,
            total: entries.length,
            filename: entry.file.name,
          });
        }
      };

      const workerCount = Math.min(DIRECT_UPLOAD_CONCURRENCY, entries.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
    },
    []
  );

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
  }, [addFiles]);

  /* ─── Upload ─── */

  /** Presigned flow: browser uploads directly to R2, then tells the API to finalize. */
  const handleTransferUpload = async () => {
    // 1. Get presigned PUT URLs
    setUploadProgress({ phase: "uploading", current: 0, total: files.length });
    const presignRes = await authFetch("/api/upload/transfer/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    // 2. Upload files directly to R2 (bounded parallelism for faster uploads)
    const filesByName = new Map<string, File[]>();
    for (const file of files) {
      const bucket = filesByName.get(file.name);
      if (bucket) {
        bucket.push(file);
      } else {
        filesByName.set(file.name, [file]);
      }
    }
    const uploadEntries = urls.map((entry) => {
      const bucket = filesByName.get(entry.name);
      const file = bucket?.shift();
      if (!file) {
        throw new Error(`Could not resolve local file for ${entry.name}`);
      }
      return { file, url: entry.url };
    });
    await uploadPresignedFiles(uploadEntries);

    // 3. Finalize — server processes thumbnails and saves metadata
    setUploadProgress({
      phase: "processing",
      current: files.length,
      total: files.length,
    });

    const finalizeRes = await authFetch("/api/upload/transfer/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  /** Words upload uses presigned PUT URLs (same as transfers). */
  const handleWordsUpload = async () => {
    const cleanSlug = slug.trim().toLowerCase();
    const cleanAssetId = assetId.trim().toLowerCase();
    if (wordsScope === "word" && !cleanSlug) throw new Error("word slug is required");
    if (wordsScope === "asset" && !cleanAssetId) throw new Error("asset id is required");

    // 1. Presign PUT URLs
    setUploadProgress({ phase: "uploading", current: 0, total: files.length });
    const presignRes = await authFetch("/api/upload/words/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: wordsScope,
        slug: wordsScope === "word" ? cleanSlug : undefined,
        assetId: wordsScope === "asset" ? cleanAssetId : undefined,
        force,
        files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });
    const presignData = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok || !presignData || presignData.success !== true) {
      throw new Error(presignData.error || "Failed to prepare words upload");
    }

    const { urls, skipped } = presignData as {
      urls: Array<{
        original: string;
        filename: string;
        uploadKey: string;
        url: string;
        kind: string;
        overwrote: boolean;
      }>;
      skipped: string[];
    };

    if (urls.length === 0) {
      return { uploaded: [], skipped };
    }

    // 2. Upload bytes direct to R2 (bounded parallelism)
    const filesByName = new Map<string, File[]>();
    for (const file of files) {
      const bucket = filesByName.get(file.name);
      if (bucket) {
        bucket.push(file);
      } else {
        filesByName.set(file.name, [file]);
      }
    }
    const uploadEntries = urls.map((entry) => {
      const bucket = filesByName.get(entry.original);
      const file = bucket?.shift();
      if (!file) {
        throw new Error(`Could not resolve local file for ${entry.original}`);
      }
      return { file, url: entry.url };
    });
    await uploadPresignedFiles(uploadEntries);

    // 3. Finalize (process images to WebP, return markdown snippets)
    setUploadProgress({ phase: "processing", current: urls.length, total: urls.length });
    const finalizeRes = await authFetch("/api/upload/words/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: wordsScope,
        slug: wordsScope === "word" ? cleanSlug : undefined,
        assetId: wordsScope === "asset" ? cleanAssetId : undefined,
        skipped,
        files: urls.map((u) => ({
          original: u.original,
          filename: u.filename,
          uploadKey: u.uploadKey,
          kind: u.kind,
          size: files.find((f) => f.name === u.original)?.size ?? 0,
          overwrote: u.overwrote,
        })),
      }),
    });
    const finalizeData = await finalizeRes.json().catch(() => ({}));
    if (!finalizeRes.ok) {
      throw new Error(finalizeData.error || "Words upload succeeded but finalization failed");
    }

    return finalizeData as WordResult;
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setUploadError("");
    setUploadProgress(null);
    setTransferResult(null);
    setWordsResult(null);

    try {
      if (mode === "transfer") {
        const result = await handleTransferUpload();
        setTransferResult(result);
      } else {
        const result = await handleWordsUpload();
        setWordsResult(result);
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

  useEffect(() => {
    if (!isAdmin && mode === "words") {
      setMode("transfer");
    }
  }, [isAdmin, mode]);

  const switchMode = (newMode: UploadMode) => {
    if (newMode === "words" && !isAdmin) return;
    setMode(newMode);
    setUploadError("");
    setTransferResult(null);
    setWordsResult(null);
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

  // Auth gate lives in `app/(utility)/upload/page.tsx` (Server Component).

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
          <Link href="/words" className="theme-muted hover:text-[var(--foreground)] transition-colors">
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
        {isAdmin ? (
          <button
            onClick={() => switchMode("words")}
            className={`font-mono text-sm lowercase tracking-wide pb-1 border-b-2 transition-colors ${
              mode === "words"
                ? "border-[var(--foreground)]"
                : "border-transparent theme-muted hover:text-[var(--foreground)]"
            }`}
          >
            words
          </button>
        ) : null}
      </div>

      {/* Mode description */}
      <p className="font-mono text-xs theme-muted mb-6">
        {mode === "transfer"
          ? "ephemeral file sharing — auto-expires after the set duration"
          : wordsScope === "word"
            ? "per-word media — uploaded to words/media/{slug}/"
            : "shared media library — uploaded to words/assets/{assetId}/"}
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setWordsScope("word")}
              className={`font-mono text-xs px-2 py-1 rounded border transition-colors ${
                wordsScope === "word"
                  ? "border-[var(--foreground)] text-[var(--foreground)]"
                  : "theme-border theme-muted hover:text-[var(--foreground)]"
              }`}
            >
              content media
            </button>
            <button
              type="button"
              onClick={() => setWordsScope("asset")}
              className={`font-mono text-xs px-2 py-1 rounded border transition-colors ${
                wordsScope === "asset"
                  ? "border-[var(--foreground)] text-[var(--foreground)]"
                  : "theme-border theme-muted hover:text-[var(--foreground)]"
              }`}
            >
              shared assets
            </button>
          </div>
          <div className="rounded-md border theme-border px-3 py-2.5">
            <p className="font-mono text-xs theme-muted">
              {wordsScope === "word"
                ? "content media: files tied to one word (hero + inline visuals)"
                : "shared assets: reusable files for multiple words (logos, recurring visuals)"}
            </p>
            <p className="font-mono text-micro theme-faint mt-1">
              destination:
              {" "}
              <code className="text-[var(--foreground)]">
                {wordsScope === "word"
                  ? `words/media/${slug.trim().toLowerCase() || "{slug}"}/`
                  : `words/assets/${assetId.trim().toLowerCase() || "{assetId}"}/`}
              </code>
            </p>
          </div>
          <div>
            <label className="font-mono text-xs theme-muted block mb-1.5">
              {wordsScope === "word" ? "slug" : "asset id"}
            </label>
            <input
              type="text"
              list={wordsScope === "word" ? "word-slug-options" : "asset-id-options"}
              value={wordsScope === "word" ? slug : assetId}
              onChange={(e) =>
                wordsScope === "word" ? setSlug(e.target.value) : setAssetId(e.target.value)
              }
              placeholder={wordsScope === "word" ? "my-post-slug" : "brand-kit"}
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm py-2 transition-colors placeholder:text-[var(--stone-400)]"
            />
            {wordsScope === "word" ? (
              <datalist id="word-slug-options">
                {wordSlugSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            ) : (
              <datalist id="asset-id-options">
                {assetSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
            <p className="font-mono text-micro theme-faint mt-1">
              {wordsScope === "word"
                ? "stores at words/media/{slug}/..."
                : "stores at words/assets/{assetId}/..."}
            </p>
            {targetsLoading ? (
              <p className="font-mono text-micro theme-faint mt-1">loading suggestions...</p>
            ) : (
              <div className="mt-1 flex items-center gap-3">
                <p className="font-mono text-micro theme-faint">
                  {wordsScope === "word"
                    ? `${wordSlugSuggestions.length} slug suggestion${wordSlugSuggestions.length === 1 ? "" : "s"}`
                    : `${assetSuggestions.length} asset suggestion${assetSuggestions.length === 1 ? "" : "s"}`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTargetsError("");
                    setTargetsResolved(false);
                  }}
                  className="font-mono text-micro theme-muted hover:text-[var(--foreground)] transition-colors"
                >
                  reload suggestions
                </button>
              </div>
            )}
            {targetsError ? (
              <p className="font-mono text-micro mt-1 text-amber-700 dark:text-amber-500/90">
                {targetsError}
              </p>
            ) : null}
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
              overwrite existing files in this target
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
              {mode === "words" && (
                <span className="theme-faint"> (direct to R2)</span>
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

      {/* Words result */}
      {wordsResult && (
        <div className="mt-8">
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-4">result</p>

            {wordsResult.uploaded.length > 0 && (
              <div className="space-y-3">
                {wordsResult.uploaded.map((file) => (
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
                    <div className="flex items-center gap-2 mt-1">
                      <code className="font-mono text-xs theme-faint flex-1 truncate">
                        {wordsScope === "word"
                          ? shortWordSnippet(file.filename, file.kind)
                          : shortAssetSnippet(assetId.trim().toLowerCase(), file.filename, file.kind)}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            wordsScope === "word"
                              ? shortWordSnippet(file.filename, file.kind)
                              : shortAssetSnippet(assetId.trim().toLowerCase(), file.filename, file.kind),
                            `short-${file.filename}`
                          )
                        }
                        className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                      >
                        {copied === `short-${file.filename}` ? "copied" : "copy short"}
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() =>
                    copyToClipboard(
                      wordsResult.uploaded.map((f) => f.markdown).join("\n"),
                      "all-markdown"
                    )
                  }
                  className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                >
                  {copied === "all-markdown" ? "copied all" : "copy all markdown"}
                </button>
              </div>
            )}

            {wordsResult.skipped.length > 0 && (
              <div className="mt-4">
                <p className="font-mono text-xs theme-muted mb-1">
                  skipped ({wordsResult.skipped.length})
                </p>
                <p className="font-mono text-xs theme-faint">
                  {wordsResult.skipped.join(", ")}
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
        <div className="flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
            ← home
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
