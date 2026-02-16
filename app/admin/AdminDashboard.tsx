"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SITE_BRAND } from "@/lib/config";
import { getStored, removeStored, setStored } from "@/lib/storage-keys";

type BlogSummary = {
  totalPosts: number;
  featuredPosts: number;
  postsWithImages: number;
  totalReadingMinutes: number;
  latestPostDate: string | null;
  recent: Array<{
    slug: string;
    title: string;
    date: string;
    readingTime: number;
    featured: boolean;
  }>;
};

type GallerySummary = {
  totalAlbums: number;
  totalPhotos: number;
  albumsWithoutDescription: number;
  invalidAlbumCount: number;
  latestAlbumDate: string | null;
  recent: Array<{
    slug: string;
    title: string;
    date: string;
    photoCount: number;
  }>;
};

type ContentSummaryResponse = {
  blog: BlogSummary;
  gallery: GallerySummary;
};

type AlbumValidationIssue = {
  slug: string;
  errors: string[];
};

type BrokenBlogRef = {
  postSlug: string;
  line: number;
  ref: string;
  key: string;
};

type ContentAuditResponse = {
  albumValidation: {
    invalidCount: number;
    invalidAlbums: AlbumValidationIssue[];
  };
  blogAudit:
    | {
        r2Configured: false;
        checkedPosts: number;
        checkedRefs: number;
        brokenRefs: BrokenBlogRef[];
        reason: string;
      }
    | {
        r2Configured: true;
        checkedPosts: number;
        checkedRefs: number;
        brokenRefs: BrokenBlogRef[];
      };
  auditedAt: string;
};

type DebugResponse = {
  environment: {
    redisConfigured: boolean;
    cronSecretConfigured: boolean;
  };
  data: {
    error: string | null;
  };
};

type AuditView = "all" | "broken-refs" | "invalid-albums";

function formatDate(date: string | null): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AdminDashboard() {
  const [mounted, setMounted] = useState(false);
  const [password, setPassword] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [content, setContent] = useState<ContentSummaryResponse | null>(null);
  const [audit, setAudit] = useState<ContentAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditView, setAuditView] = useState<AuditView>("all");
  const [showAllBrokenRefs, setShowAllBrokenRefs] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);

  useEffect(() => {
    const token = getStored("adminToken") ?? "";
    setAdminToken(token);
    setMounted(true);
  }, []);

  const isAuthed = !!adminToken;

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers as Record<string, string>),
          Authorization: `Bearer ${adminToken}`,
        },
      });
      if (res.status === 401) {
        removeStored("adminToken");
        setAdminToken("");
      }
      return res;
    },
    [adminToken]
  );

  const refreshDashboard = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const [contentRes, debugRes] = await Promise.all([
        authFetch("/api/admin/content-summary"),
        authFetch("/api/debug"),
      ]);

      if (!contentRes.ok) {
        throw new Error("Failed to load content summary");
      }
      if (!debugRes.ok) {
        throw new Error("Failed to load system status");
      }

      const [contentJson, debugJson] = await Promise.all([
        contentRes.json(),
        debugRes.json(),
      ]);

      setContent(contentJson as ContentSummaryResponse);
      setDebugData(debugJson as DebugResponse);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to refresh dashboard";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthed]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setStored("adminToken", data.token);
        setAdminToken(data.token);
        setPassword("");
        setStatusMessage("Admin access unlocked.");
        setTimeout(() => setStatusMessage(""), 2500);
      } else {
        setAuthError(
          res.status === 429
            ? "Too many attempts. Please try again in 15 minutes."
            : "Incorrect password"
        );
      }
    } catch {
      setAuthError("Connection error");
    } finally {
      setAuthLoading(false);
    }
  };

  const runContentAudit = async () => {
    setAuditLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const res = await authFetch("/api/admin/content-audit");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to run content audit");
      }
      setAudit(data as ContentAuditResponse);
      setAuditView("all");
      setShowAllBrokenRefs(false);
      setStatusMessage("Content audit completed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Content audit failed";
      setErrorMessage(msg);
    } finally {
      setAuditLoading(false);
    }
  };

  const commandHelpers = [
    {
      key: "albums-upload",
      label: "upload new album",
      cmd: "pnpm cli albums upload",
      tip: "Creates a new album manifest and uploads images to R2.",
    },
    {
      key: "photos-add",
      label: "add photos to album",
      cmd: "pnpm cli photos add <album-slug>",
      tip: "Adds new files to an existing album slug.",
    },
    {
      key: "blog-upload",
      label: "upload blog media",
      cmd: "pnpm cli blog upload --slug <post-slug> --dir <path>",
      tip: "Processes images to WebP and prints markdown snippets to paste in posts.",
    },
    {
      key: "blog-list",
      label: "list blog media",
      cmd: "pnpm cli blog list <post-slug>",
      tip: "Lists all uploaded files under blog/<post-slug>/ in R2.",
    },
  ] as const;

  const copyCommand = async (key: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(key);
      setTimeout(() => setCopiedCommand(null), 1800);
    } catch {
      setErrorMessage("Clipboard write failed");
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" aria-busy="true">
        <div className="w-8 h-8 border-2 border-[var(--foreground)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <form onSubmit={handleAuth} className="w-full max-w-xs text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">
            {SITE_BRAND}
          </h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-8">admin</p>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="admin password"
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
            disabled={!password || authLoading}
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

  return (
    <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
      <header className="mb-10">
        <h1 className="font-mono font-bold tracking-tighter text-lg">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">· admin</span>
        </h1>
        <nav
          className="mt-3 flex items-center gap-6 font-mono text-xs tracking-wide"
          aria-label="Admin navigation"
        >
          <Link href="/upload" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            upload
          </Link>
          <Link href="/blog" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            words
          </Link>
          <Link href="/pics" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            pics
          </Link>
        </nav>
      </header>

      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-3 font-mono text-sm">
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">blog posts</p>
            <p className="text-lg">{content?.blog.totalPosts ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">featured posts</p>
            <p className="text-lg">{content?.blog.featuredPosts ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">albums</p>
            <p className="text-lg">{content?.gallery.totalAlbums ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">photos</p>
            <p className="text-lg">{content?.gallery.totalPhotos ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">latest post</p>
            <p className="text-sm">{formatDate(content?.blog.latestPostDate ?? null)}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">latest album</p>
            <p className="text-sm">{formatDate(content?.gallery.latestAlbumDate ?? null)}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">posts with hero image</p>
            <p className="text-lg">{content?.blog.postsWithImages ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">invalid albums</p>
            <p className="text-lg">{content?.gallery.invalidAlbumCount ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">reading minutes</p>
            <p className="text-lg">{content?.blog.totalReadingMinutes ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">albums missing description</p>
            <p className="text-lg">{content?.gallery.albumsWithoutDescription ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">redis status</p>
            <p className="text-lg">
              {debugData?.environment.redisConfigured ? "ok" : "missing"}
            </p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">cron secret</p>
            <p className="text-lg">
              {debugData?.environment.cronSecretConfigured ? "ok" : "missing"}
            </p>
          </div>
        </div>

        <div className="border-t theme-border pt-6">
          <p className="font-mono text-xs theme-muted mb-2">editorial tools</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              href="/upload"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              open upload dashboard
            </Link>
            <Link
              href="/blog"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              browse words
            </Link>
            <Link
              href="/pics"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              browse pics
            </Link>
            <button
              type="button"
              disabled={loading}
              onClick={() => void refreshDashboard()}
              title="Re-fetches blog/gallery counts and system status cards. It does not run the deep content audit."
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm text-left hover:border-[var(--stone-400)] transition-colors disabled:opacity-50"
            >
              {loading ? "refreshing..." : "refresh content summary"}
            </button>
            <button
              type="button"
              disabled={auditLoading}
              onClick={() => void runContentAudit()}
              title="Runs deeper checks: album manifest validation + broken blog media references against R2."
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm text-left hover:border-[var(--stone-400)] transition-colors disabled:opacity-50"
            >
              {auditLoading ? "auditing..." : "run content audit"}
            </button>
          </div>
        </div>

        <div className="border-t theme-border pt-6">
          <p className="font-mono text-xs theme-muted mb-2">copy CLI commands</p>
          <div className="space-y-2 font-mono text-xs">
            {commandHelpers.map((item) => (
              <div key={item.key} className="border theme-border rounded-md p-2 flex items-center gap-2">
                <span className="theme-muted shrink-0" title={item.tip}>
                  {item.label}
                </span>
                <code className="truncate flex-1">{item.cmd}</code>
                <button
                  type="button"
                  onClick={() => void copyCommand(item.key, item.cmd)}
                  title={item.tip}
                  className="theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                >
                  {copiedCommand === item.key ? "copied" : "copy"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {content?.blog.recent?.length ? (
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-2">recent posts</p>
            <ul className="space-y-1 font-mono text-sm">
              {content.blog.recent.map((post) => (
                <li key={post.slug} className="flex items-center justify-between gap-3">
                  <Link href={`/blog/${post.slug}`} className="truncate hover:opacity-80 transition-opacity">
                    {post.title}
                  </Link>
                  <span className="theme-muted shrink-0">{post.readingTime} min</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {content?.gallery.recent?.length ? (
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-2">recent albums</p>
            <ul className="space-y-1 font-mono text-sm">
              {content.gallery.recent.map((album) => (
                <li key={album.slug} className="flex items-center justify-between gap-3">
                  <Link href={`/pics/${album.slug}`} className="truncate hover:opacity-80 transition-opacity">
                    {album.title}
                  </Link>
                  <span className="theme-muted shrink-0">{album.photoCount} photos</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {audit ? (
          <div className="border-t theme-border pt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs theme-muted">content audit results</p>
              <div className="flex items-center gap-2 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setAuditView("all")}
                  className={`px-2 py-1 rounded border transition-colors ${
                    auditView === "all"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  all
                </button>
                <button
                  type="button"
                  onClick={() => setAuditView("broken-refs")}
                  className={`px-2 py-1 rounded border transition-colors ${
                    auditView === "broken-refs"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  only missing refs
                </button>
                <button
                  type="button"
                  onClick={() => setAuditView("invalid-albums")}
                  className={`px-2 py-1 rounded border transition-colors ${
                    auditView === "invalid-albums"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  only invalid albums
                </button>
              </div>
            </div>
            <p className="font-mono text-xs theme-muted">
              audited {formatDate(audit.auditedAt)}
            </p>

            {auditView !== "broken-refs" ? (
            <div className="border theme-border rounded-md p-3">
              <p className="font-mono text-xs theme-muted mb-1">album manifest validation</p>
              <p className="font-mono text-sm">
                invalid albums: {audit.albumValidation.invalidCount}
              </p>
              {audit.albumValidation.invalidAlbums.length > 0 ? (
                <ul className="mt-2 space-y-2 font-mono text-xs">
                  {audit.albumValidation.invalidAlbums.map((album) => (
                    <li key={album.slug}>
                      <p className="theme-muted">{album.slug}</p>
                      <p>{album.errors.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            ) : null}

            {auditView !== "invalid-albums" ? (
            <div className="border theme-border rounded-md p-3">
              <p className="font-mono text-xs theme-muted mb-1">blog media reference audit</p>
              <p className="font-mono text-sm">
                refs checked: {audit.blogAudit.checkedRefs} · broken refs: {audit.blogAudit.brokenRefs.length}
              </p>
              {!audit.blogAudit.r2Configured ? (
                <p className="font-mono text-xs theme-muted mt-2">{audit.blogAudit.reason}</p>
              ) : null}
              {audit.blogAudit.brokenRefs.length > 0 ? (
                <>
                <ul className="mt-2 space-y-2 font-mono text-xs">
                  {(showAllBrokenRefs
                    ? audit.blogAudit.brokenRefs
                    : audit.blogAudit.brokenRefs.slice(0, 20)
                  ).map((ref) => (
                    <li key={`${ref.postSlug}-${ref.line}-${ref.key}`}>
                      <p className="theme-muted">
                        {ref.postSlug} line {ref.line}
                      </p>
                      <p className="truncate">{ref.key}</p>
                    </li>
                  ))}
                </ul>
                {audit.blogAudit.brokenRefs.length > 20 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllBrokenRefs((v) => !v)}
                    className="mt-2 font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                  >
                    {showAllBrokenRefs
                      ? "show fewer broken refs"
                      : `show all broken refs (${audit.blogAudit.brokenRefs.length})`}
                  </button>
                ) : null}
                </>
              ) : null}
            </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t theme-border pt-6">
          <p className="font-mono text-xs theme-muted mb-2">party tools (secondary)</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              href="/guestlist"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              manage guestlist
            </Link>
            <Link
              href="/best-dressed"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              best-dressed votes
            </Link>
          </div>
        </div>

        {debugData?.data.error ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">
            debug warning: {debugData.data.error}
          </p>
        ) : null}
        {statusMessage ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">{statusMessage}</p>
        ) : null}
        {errorMessage ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">{errorMessage}</p>
        ) : null}
      </section>
    </div>
  );
}
